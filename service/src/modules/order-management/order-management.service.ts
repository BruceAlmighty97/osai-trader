import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IBApi,
  Contract,
  Order,
  EventName,
  OrderAction,
  OrderType,
  SecType,
  OptionType,
  OrderStatus,
  TimeInForce,
} from '@stoqey/ib';
import { IbkrService } from '../ibkr/ibkr.service';
import { RiskManagementService } from '../risk-management/risk-management.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { OrderEntity } from './order.entity';
import {
  SubmitOrderDto,
  TrackedOrder,
  OrderLifecycleStatus,
  TradeSecType,
  TradeOrderType,
} from './order.types';

@Injectable()
export class OrderManagementService implements OnModuleInit {
  private readonly logger = new Logger(OrderManagementService.name);
  private nextOrderId: number | null = null;
  private readonly activeOrders = new Map<number, TrackedOrder>();

  constructor(
    private readonly ibkrService: IbkrService,
    private readonly riskService: RiskManagementService,
    private readonly portfolioService: PortfolioService,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  async onModuleInit() {
    this.ibkrService.onApiConnected((api) => this.registerOrderEventHandlers(api));
  }

  private registerOrderEventHandlers(api: IBApi) {
    this.logger.log('Registering order event handlers on IBKR API');

    api.on(EventName.nextValidId, (orderId: number) => {
      this.nextOrderId = orderId;
      this.logger.log(`Next valid order ID: ${orderId}`);
    });

    api.on(
      EventName.orderStatus,
      (
        orderId: number,
        status: OrderStatus,
        filled: number,
        remaining: number,
        avgFillPrice: number,
      ) => {
        this.logger.log(`Order status event — orderId: ${orderId}, status: ${status}, filled: ${filled}, remaining: ${remaining}`);
        this.handleOrderStatusUpdate(orderId, status, filled, remaining, avgFillPrice);
      },
    );

    api.on(EventName.openOrder, (orderId: number, contract: Contract, order: Order) => {
      this.logger.log(`Open order event — orderId: ${orderId}, ${order.action} ${order.totalQuantity} ${contract.symbol}`);
    });

    api.on(EventName.error, (error: Error, code: number, reqId: number) => {
      if (this.activeOrders.has(reqId)) {
        if (code >= 10000) {
          this.logger.warn(`Order ${reqId} warning: [${code}] ${error.message}`);
          return;
        }
        this.handleOrderError(reqId, code, error.message);
      }
    });
  }

  private async handleOrderStatusUpdate(
    orderId: number,
    status: OrderStatus,
    filled: number,
    remaining: number,
    avgFillPrice: number,
  ) {
    const tracked = this.activeOrders.get(orderId);
    if (!tracked) return;

    const mappedStatus = this.mapIbkrStatus(status);
    tracked.status = mappedStatus;
    tracked.filledQuantity = filled;
    tracked.remaining = remaining;
    tracked.avgFillPrice = avgFillPrice;
    tracked.updatedAt = new Date();

    this.logger.log(
      `Order ${orderId} [${tracked.symbol}]: ${status} — filled ${filled}, remaining ${remaining}, avgPrice ${avgFillPrice}`,
    );

    // Persist to database
    await this.orderRepo.update(
      { orderId },
      {
        status: mappedStatus,
        filledQuantity: filled,
        remaining,
        avgFillPrice,
      },
    );

    // Clean up fully filled or cancelled orders from active tracking
    if (
      mappedStatus === OrderLifecycleStatus.FILLED ||
      mappedStatus === OrderLifecycleStatus.CANCELLED
    ) {
      this.activeOrders.delete(orderId);
    }
  }

  private async handleOrderError(orderId: number, code: number, message: string) {
    const tracked = this.activeOrders.get(orderId);
    if (!tracked) return;

    tracked.status = OrderLifecycleStatus.ERROR;
    tracked.errorMessage = `[${code}] ${message}`;
    tracked.updatedAt = new Date();

    this.logger.error(`Order ${orderId} error: [${code}] ${message}`);

    await this.orderRepo.update(
      { orderId },
      {
        status: OrderLifecycleStatus.ERROR,
        errorMessage: tracked.errorMessage,
      },
    );

    this.activeOrders.delete(orderId);
  }

  private mapIbkrStatus(status: OrderStatus): OrderLifecycleStatus {
    switch (status) {
      case OrderStatus.Submitted:
      case OrderStatus.PreSubmitted:
        return OrderLifecycleStatus.SUBMITTED;
      case OrderStatus.Filled:
        return OrderLifecycleStatus.FILLED;
      case OrderStatus.Cancelled:
        return OrderLifecycleStatus.CANCELLED;
      case OrderStatus.Inactive:
        return OrderLifecycleStatus.ERROR;
      default:
        return OrderLifecycleStatus.SUBMITTED;
    }
  }

  // --- Public API ---

  async submitOrder(dto: SubmitOrderDto): Promise<TrackedOrder> {
    if (!this.ibkrService.isConnected()) {
      throw new Error('Not connected to IBKR');
    }

    if (this.nextOrderId === null) {
      throw new Error('Order ID not initialized — IBKR connection may not be ready');
    }

    // Run risk pre-trade check
    const positions = await this.portfolioService.getPositions();
    const account = await this.ibkrService.getAccountSummary();

    const riskCheck = await this.riskService.validateTrade({
      positionSize: dto.quantity,
      notionalValue: dto.quantity * (dto.limitPrice || 0) * (dto.secType === TradeSecType.OPTION ? 100 : 1),
      currentOpenPositions: positions.length,
      portfolioDelta: 0, // TODO: aggregate from market data when available
      portfolioGamma: 0,
      buyingPowerUsage: 0, // TODO: calculate from account data
      marginUsage: 0,
      dailyLoss: 0, // TODO: track from today's closed trades
      weeklyLoss: 0,
      dataAgeSeconds: 0,
    });

    if (!riskCheck.approved) {
      throw new Error(`Trade rejected by risk management: ${riskCheck.violations.join('; ')}`);
    }

    // Build IBKR contract
    const contract = this.buildContract(dto);

    // Build IBKR order
    const orderId = this.nextOrderId++;
    const order = this.buildOrder(dto);

    // Track locally
    const tracked: TrackedOrder = {
      orderId,
      symbol: dto.symbol,
      secType: dto.secType,
      action: dto.action,
      quantity: dto.quantity,
      orderType: dto.orderType,
      limitPrice: dto.limitPrice,
      stopPrice: dto.stopPrice,
      status: OrderLifecycleStatus.PENDING,
      filledQuantity: 0,
      avgFillPrice: 0,
      remaining: dto.quantity,
      expiration: dto.expiration,
      strike: dto.strike,
      right: dto.right,
      submittedAt: new Date(),
      updatedAt: new Date(),
    };

    this.activeOrders.set(orderId, tracked);

    // Persist to database
    await this.orderRepo.save({
      orderId,
      symbol: dto.symbol,
      secType: dto.secType,
      action: dto.action,
      quantity: dto.quantity,
      orderType: dto.orderType,
      limitPrice: dto.limitPrice ?? null,
      stopPrice: dto.stopPrice ?? null,
      exchange: dto.exchange || 'SMART',
      currency: dto.currency || 'USD',
      expiration: dto.expiration ?? null,
      strike: dto.strike ?? null,
      right: dto.right ?? null,
      status: OrderLifecycleStatus.PENDING,
      remaining: dto.quantity,
    });

    // Submit to IBKR
    this.logger.log(
      `Submitting order ${orderId}: ${dto.action} ${dto.quantity} ${dto.symbol} ${dto.orderType}${dto.limitPrice ? ` @ ${dto.limitPrice}` : ''}`,
    );

    const api = this.ibkrService.getApi();
    api.placeOrder(orderId, contract, order);

    return tracked;
  }

  async cancelOrder(orderId: number): Promise<void> {
    if (!this.ibkrService.isConnected()) {
      throw new Error('Not connected to IBKR');
    }

    this.logger.log(`Cancelling order ${orderId}`);
    const api = this.ibkrService.getApi();
    api.cancelOrder(orderId);
  }

  async getOpenOrders(): Promise<TrackedOrder[]> {
    const api = this.ibkrService.getApi();

    if (!this.ibkrService.isConnected()) {
      throw new Error('Not connected to IBKR');
    }

    return new Promise((resolve) => {
      const orders: TrackedOrder[] = [];

      const timeout = setTimeout(() => {
        this.logger.warn(`getOpenOrders timed out — received ${orders.length} orders before timeout`);
        cleanup();
        resolve(orders);
      }, 10000);

      const onOpenOrder = (orderId: number, contract: Contract, order: Order) => {
        orders.push({
          orderId,
          symbol: contract.symbol || '',
          secType: contract.secType || '',
          action: order.action || '',
          quantity: order.totalQuantity || 0,
          orderType: order.orderType || '',
          limitPrice: order.lmtPrice,
          stopPrice: order.auxPrice,
          status: OrderLifecycleStatus.SUBMITTED,
          filledQuantity: 0,
          avgFillPrice: 0,
          remaining: order.totalQuantity || 0,
          expiration: contract.lastTradeDateOrContractMonth,
          strike: contract.strike,
          right: contract.right,
          submittedAt: new Date(),
          updatedAt: new Date(),
        });
      };

      const onOpenOrderEnd = () => {
        this.logger.log(`getOpenOrders complete — found ${orders.length} orders`);
        clearTimeout(timeout);
        cleanup();
        resolve(orders);
      };

      const cleanup = () => {
        api.removeListener(EventName.openOrder, onOpenOrder);
        api.removeListener(EventName.openOrderEnd, onOpenOrderEnd);
      };

      api.on(EventName.openOrder, onOpenOrder);
      api.on(EventName.openOrderEnd, onOpenOrderEnd);

      api.reqAllOpenOrders();
    });
  }

  async getOrderHistory(limit = 50): Promise<OrderEntity[]> {
    return this.orderRepo.find({
      order: { submittedAt: 'DESC' },
      take: limit,
    });
  }

  async getOrder(orderId: number): Promise<OrderEntity | null> {
    return this.orderRepo.findOne({ where: { orderId } });
  }

  private buildContract(dto: SubmitOrderDto): Contract {
    const contract: Contract = {
      symbol: dto.symbol,
      secType: dto.secType === TradeSecType.OPTION ? SecType.OPT : SecType.STK,
      exchange: dto.exchange || 'SMART',
      currency: dto.currency || 'USD',
    };

    if (dto.secType === TradeSecType.OPTION) {
      contract.lastTradeDateOrContractMonth = dto.expiration;
      contract.strike = dto.strike;
      contract.right = dto.right === 'C' ? OptionType.Call : OptionType.Put;
      contract.multiplier = 100;
    }

    return contract;
  }

  private buildOrder(dto: SubmitOrderDto): Order {
    const order: Order = {
      action: dto.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      totalQuantity: dto.quantity,
      orderType: this.mapOrderType(dto.orderType),
      tif: TimeInForce.DAY,
      transmit: true,
    };

    if (dto.limitPrice !== undefined) {
      order.lmtPrice = dto.limitPrice;
    }

    if (dto.stopPrice !== undefined) {
      order.auxPrice = dto.stopPrice;
    }

    return order;
  }

  private mapOrderType(type: TradeOrderType): OrderType {
    switch (type) {
      case TradeOrderType.MARKET: return OrderType.MKT;
      case TradeOrderType.LIMIT: return OrderType.LMT;
      case TradeOrderType.STOP: return OrderType.STP;
      case TradeOrderType.STOP_LIMIT: return OrderType.STP_LMT;
      default: return OrderType.LMT;
    }
  }
}
