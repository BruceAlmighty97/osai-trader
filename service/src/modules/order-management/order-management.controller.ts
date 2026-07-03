import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrderManagementService } from './order-management.service';
import { SubmitOrderDto } from './order.types';

@ApiTags('Orders')
@Controller('orders')
export class OrderManagementController {
  constructor(private readonly orderService: OrderManagementService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new order (runs risk checks first)' })
  @ApiBody({ type: SubmitOrderDto })
  async submitOrder(@Body() dto: SubmitOrderDto) {
    return this.orderService.submitOrder(dto);
  }

  @Delete(':orderId')
  @ApiOperation({ summary: 'Cancel an open order' })
  @ApiParam({ name: 'orderId', example: 1 })
  async cancelOrder(@Param('orderId') orderId: number) {
    await this.orderService.cancelOrder(+orderId);
    return { message: `Cancel request sent for order ${orderId}` };
  }

  @Get('open')
  @ApiOperation({ summary: 'Get all currently active/open orders' })
  async getOpenOrders() {
    return this.orderService.getOpenOrders();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get order history from database' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  async getOrderHistory(@Query('limit') limit?: number) {
    return this.orderService.getOrderHistory(limit ? +limit : 50);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get a specific order by IBKR order ID' })
  @ApiParam({ name: 'orderId', example: 1 })
  async getOrder(@Param('orderId') orderId: number) {
    const order = await this.orderService.getOrder(+orderId);
    if (!order) {
      return { error: `Order ${orderId} not found` };
    }
    return order;
  }
}
