# Presale Contract Setup Guide

## Overview

The presale contract allows users to buy presale tokens using allowed payment tokens (USDC, USDT, etc.). The admin can control the presale status and manage allowed payment tokens.

## Architecture

### Key Components

1. **PresaleState**: Main state account storing:
   - Admin address
   - Presale token mint address
   - Presale status (NotStarted, Active, Paused, Stopped)
   - Total tokens sold
   - Total raised

2. **Token Vaults**:
   - **Presale Token Vault**: ATA owned by a PDA, holds presale tokens to be sold
   - **Payment Token Vaults**: ATAs owned by PDAs, one for each allowed payment token (USDC, USDT, etc.)

3. **AllowedToken**: Tracks which payment tokens are allowed for purchases

## Deployment Steps

### 1. Build the Program

```bash
anchor build
```

This will generate the program ID and update the `declare_id!` macro in `lib.rs`.

### 2. Deploy the Presale Contract

```bash
ts-node scripts/deploy-presale.ts [PRESALE_TOKEN_MINT]
```

Or set the environment variable:
```bash
export PRESALE_TOKEN_MINT=<your_token_mint_address>
ts-node scripts/deploy-presale.ts
```

This will:
- Initialize the presale state with you as admin
- Create the presale token vault ATA (if possible)
- Save deployment info to `presale-deployment-info.json`

### 3. Transfer Presale Tokens to Vault

After deployment, you need to transfer presale tokens to the vault ATA:

```bash
ts-node scripts/transfer-tokens-to-vault.ts <AMOUNT> [PRESALE_TOKEN_MINT]
```

Example:
```bash
ts-node scripts/transfer-tokens-to-vault.ts 1000000
```

This will:
- Create the vault ATA if it doesn't exist
- Transfer tokens from your wallet to the vault ATA

### 4. Get Vault Address (Optional)

To get the vault ATA address for manual transfers:

```bash
ts-node scripts/get-presale-vault-address.ts [PRESALE_TOKEN_MINT]
```

## Admin Functions

### Allow Payment Token

Allow users to buy with a specific payment token (e.g., USDC, USDT):

```typescript
await presaleProgram.methods
  .allowPaymentToken(paymentTokenMint)
  .accounts({
    presaleState: presaleStatePda,
    allowedToken: allowedTokenPda,
    admin: adminKeypair.publicKey,
    paymentTokenMint: paymentTokenMint,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Disallow Payment Token

Disallow a payment token:

```typescript
await presaleProgram.methods
  .disallowPaymentToken()
  .accounts({
    presaleState: presaleStatePda,
    allowedToken: allowedTokenPda,
    admin: adminKeypair.publicKey,
    paymentTokenMint: paymentTokenMint,
  })
  .rpc();
```

### Start Presale

```typescript
await presaleProgram.methods
  .startPresale()
  .accounts({
    presaleState: presaleStatePda,
    admin: adminKeypair.publicKey,
  })
  .rpc();
```

### Pause Presale

```typescript
await presaleProgram.methods
  .pausePresale()
  .accounts({
    presaleState: presaleStatePda,
    admin: adminKeypair.publicKey,
  })
  .rpc();
```

### Stop Presale

```typescript
await presaleProgram.methods
  .stopPresale()
  .accounts({
    presaleState: presaleStatePda,
    admin: adminKeypair.publicKey,
  })
  .rpc();
```

## User Buy Function

Users can buy presale tokens:

```typescript
await presaleProgram.methods
  .buy(amount) // amount in payment token units
  .accounts({
    presaleState: presaleStatePda,
    allowedToken: allowedTokenPda,
    buyer: buyerKeypair.publicKey,
    buyerPaymentTokenAccount: buyerPaymentTokenAta,
    presalePaymentVaultPda: paymentVaultPda,
    presalePaymentVault: paymentVaultAta,
    presaleTokenVaultPda: tokenVaultPda,
    presaleTokenVault: tokenVaultAta,
    buyerTokenAccount: buyerTokenAta,
    paymentTokenMint: paymentTokenMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

## Important Addresses

After deployment, check `presale-deployment-info.json` for:
- `presaleProgramId`: The presale program ID
- `presaleStatePda`: The presale state account
- `presaleTokenMint`: The token being sold
- `presaleTokenVaultPda`: PDA that owns the token vault
- `presaleTokenVaultAta`: **This is where you transfer presale tokens**
- `admin`: Your admin address

## Token Vault Address Calculation

The presale token vault ATA is calculated as:

```typescript
// 1. Derive the PDA owner
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("presale_token_vault_pda"), presaleTokenMint.toBuffer()],
  presaleProgramId
);

// 2. Derive the ATA from the PDA
const vaultAta = await getAssociatedTokenAddress(
  presaleTokenMint,
  vaultPda,
  true // allowOwnerOffCurve for PDA
);
```

**This ATA address is where the admin should transfer presale tokens after deployment.**

## Notes

- The presale uses a 1:1 exchange rate by default (1 payment token = 1 presale token)
- You can modify the pricing logic in the `buy` function in `lib.rs`
- Payment token vaults are created automatically when tokens are received
- The presale must be in "Active" status for users to buy

