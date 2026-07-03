# IBKR Integration Notes

## Connection Architecture
- IB Gateway runs in headless mode as an ECS sidecar container
- NestJS connects via TCP socket on port 4001 (live) or 4002 (paper)
- **Start with paper trading** (port 4002) for all development and initial testing

## Library: @stoqey/ib
- Maintained Node.js wrapper for the TWS API
- Handles: orders, market data, account info, positions, contract lookups
- GitHub: https://github.com/stoqey/ib

## Key IBKR Behaviors to Handle
- **Daily restart**: IB Gateway requires a daily restart; connections drop around 11:45 PM ET
- **Reconnection**: must implement robust reconnection logic with exponential backoff
- **Rate limits**: IBKR throttles API requests aggressively — need request queue with rate limiting
- **Market data subscriptions**: limited number of concurrent subscriptions based on account tier
- **Order ID management**: IBKR requires unique, incrementing order IDs — must persist the next valid ID

## Paper Trading Environment
- Separate credentials from live account
- Same API, different port (4002)
- Some behavioral differences: fills are simulated, not all order types supported
- Use for all development, testing, and initial AI strategy validation

## Market Data Types

Controlled by the `IBKR_MARKET_DATA_TYPE` env var:

| Value | Type           | Description                                      | Cost       |
|-------|----------------|--------------------------------------------------|------------|
| 1     | Live           | Real-time streaming data                         | Paid subscription required |
| 2     | Frozen         | Last snapshot when market is closed               | Paid subscription required |
| 3     | Delayed        | ~15 min delayed data                             | Free       |
| 4     | Delayed-Frozen | Delayed snapshot when market is closed            | Free       |

**Currently using type 3 (delayed) for development.**

To switch to live data before production:
1. Subscribe to market data in IBKR Account Management → Settings → Market Data Subscriptions
   - **US Securities Snapshot and Futures Value Bundle** (~$10/month) covers US stocks and options
   - IBKR waives fees if monthly commissions exceed ~$30
2. Set `IBKR_MARKET_DATA_TYPE=1` in `.env`

## Options-Specific Considerations
- Options chain requests can be large — filter by expiration/strike range before requesting
- Greeks are available via market data subscriptions (tick types 10-13)
- Combo/spread orders have specific contract formatting requirements
- Exercise and assignment notifications come through account update callbacks
