# Deployment Instructions

This guide will help you deploy the token contract and initialize the NC token with Metaplex metadata.

## Prerequisites

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Build the program:**
   ```bash
   anchor build
   ```

3. **Deploy the program:**
   ```bash
   anchor deploy
   ```

## Token Configuration

- **Name**: NC
- **Symbol**: NC
- **Decimals**: 9
- **Total Supply**: 100,000,000,000 (100 billion)

## Deploy and Initialize Token

After building and deploying the program, run the deploy script to initialize the token:

```bash
yarn deploy
```

Or directly:
```bash
ts-node scripts/deploy.ts
```

## What the Deploy Script Does

1. ✅ Initializes the program state
2. ✅ Creates the token mint with 9 decimals
3. ✅ Creates Metaplex metadata (Name: "NC", Symbol: "NC")
4. ✅ Transfers mint authority to the state PDA
5. ✅ Creates a token account
6. ✅ Mints 100 billion tokens to your wallet

## Environment Variables (Optional)

- `ANCHOR_PROVIDER_URL`: RPC endpoint (defaults to devnet)
- `ANCHOR_WALLET`: Path to wallet keypair (defaults to `~/.config/solana/id.json`)

## Output

The script will create a `deployment-info.json` file with all the deployment details including:
- Program ID
- Mint address
- Metadata address
- State PDA
- Token account
- And more...

## Network Configuration

Make sure your `Anchor.toml` is configured for the network you want to deploy to:

```toml
[provider]
cluster = "devnet"  # or "mainnet-beta" or "localnet"
wallet = "~/.config/solana/id.json"
```

