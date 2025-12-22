# SPL Token Project with Metaplex Metadata

This project implements an SPL token with Metaplex on-chain metadata, featuring:
- **Token Name**: NC
- **Token Symbol**: NC
- **Decimals**: 9
- **Total Supply**: 100 Billion tokens
- **Initial Supply**: 100 Million tokens (minted at deployment)

## Prerequisites

1. **Solana CLI** installed
2. **Anchor** installed
3. **Node.js** and **Yarn** installed
4. **Wallet** configured for deployment

## Installation

```bash
# Install dependencies
yarn install

# Build the program
anchor build
```

## Deployment

### 1. Configure for Devnet

Update `Anchor.toml` to use devnet:

```toml
[provider]
cluster = "devnet"
wallet = "~/.config/solana/phantom.json"
```

Or set environment variable:
```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
```

### 2. Switch to Devnet

```bash
solana config set --url devnet
```

### 3. Get Devnet SOL

```bash
solana airdrop 2
```

### 4. Deploy

```bash
yarn deploy:devnet
```

This will:
- Build and deploy the program
- Create token mint with 9 decimals
- Create Metaplex metadata (Name: "NC", Symbol: "NC")
- Transfer mint authority to state PDA
- Mint 100 Million tokens initially
- Save deployment info to `deployment-info.json`

## Token Configuration

The token is configured with:
- **Name**: NC
- **Symbol**: NC
- **Decimals**: 9
- **Total Supply**: 100,000,000,000 tokens
- **Initial Supply**: 100,000,000 tokens

To change these values, edit `scripts/deploy-token.ts`:

```typescript
const TOKEN_NAME = "NC";
const TOKEN_SYMBOL = "NC";
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000_000; // 100 Billion
const INITIAL_SUPPLY = 100_000_000; // 100 Million
```

## Minting Remaining Tokens

After deployment, you can mint the remaining tokens (up to 100 Billion total) using the program:

```typescript
const remainingToMint = (100_000_000_000 - 100_000_000) * 10 ** 9;
await program.methods
  .mintTokens(new anchor.BN(remainingToMint.toString()))
  .accounts({
    state: statePda,
    mint: mint.publicKey,
    to: tokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

## Transferring Ownership

To transfer ownership and all tokens to a new owner:

### Option 1: Using the Script

1. Edit `scripts/transfer-ownership.ts`:
   ```typescript
   const NEW_OWNER_ADDRESS = "NewOwnerPublicKeyHere...";
   const REVOKE_MINT_AUTHORITY = true; // Set to true to revoke mint authority
   ```

2. Run the script:
   ```bash
   yarn transfer-ownership
   ```

   Or the script will prompt for the new owner address if not set.

### Option 2: Manual Transfer

The script will:
1. Check current token balance
2. Create token account for new owner
3. Transfer all existing tokens to new owner
4. Mint remaining tokens (up to total supply) to new owner
5. Transfer metadata update authority to new owner
6. Attempt to revoke mint authority (if configured)

## Important Notes

### Mint Authority

- **After Deployment**: Mint authority is transferred to the state PDA (program-controlled)
- **To Revoke**: You need to create a program instruction to set mint authority to `null`
- **Current State**: Mint authority remains with state PDA, allowing program-controlled minting

### Program Ownership

Program ownership transfer is separate from token ownership:
- **Upgrade Authority**: Controlled by the deployer wallet
- **To Transfer**: Use `solana program set-upgrade-authority` or deploy new version
- **Token Ownership**: Transferred via the transfer script

### Metadata

- **Update Authority**: Initially set to deployer wallet
- **After Transfer**: Transferred to new owner via transfer script
- **On-Chain**: Metadata is stored on-chain via Metaplex

## File Structure

```
spl-project/
├── programs/
│   └── spl-project/
│       └── src/
│           └── lib.rs          # Anchor program
├── scripts/
│   ├── deploy-token.ts         # Deployment script
│   └── transfer-ownership.ts  # Ownership transfer script
├── tests/
│   └── spl-project.ts          # Tests
├── deployment-info.json        # Generated after deployment
└── Anchor.toml                 # Anchor configuration
```

## Testing

Run tests:

```bash
anchor test
```

## Troubleshooting

### Insufficient Balance
```bash
solana airdrop 2
```

### Program Already Deployed
The scripts handle existing deployments gracefully and skip initialization if already done.

### Metadata Creation Failed
If metadata creation fails, ensure:
- Wallet has sufficient SOL
- Mint authority is correct
- Metaplex program is available on the cluster

## Security Notes

1. **Save Mint Keypair**: The deployment script outputs the mint private key - save it securely
2. **Mint Authority**: Consider revoking mint authority after all tokens are minted
3. **Program Ownership**: Transfer program upgrade authority if needed
4. **Private Keys**: Never commit private keys to version control

## Support

For issues or questions, check:
- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [Metaplex Documentation](https://docs.metaplex.com/)

