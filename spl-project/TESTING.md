# Testing Guide: Revoke Mint and Update Authorities

This guide explains how to test the `revoke-authorities.sh` script that revokes both mint authority and update authority for your SPL token.

## Prerequisites

1. **Anchor CLI** installed and configured
2. **Yarn** package manager installed
3. **Solana CLI** tools installed (`solana`, `spl-token`)
4. **Wallet** configured with sufficient SOL for transaction fees
5. **Program built** - Run `anchor build` before testing

## Quick Start

### Option 1: Using deployment-info.json (Recommended)

If you have a `deployment-info.json` file with your deployment details:

```bash
./revoke-authorities.sh
```

The script will automatically load:
- `mint` → MINT_ADDRESS
- `statePda` → STATE_PDA
- `metadata` → METADATA_ADDRESS (optional)
- `network` → NETWORK

### Option 2: Using Command Line Arguments

```bash
./revoke-authorities.sh <MINT_ADDRESS> <STATE_PDA> [METADATA_ADDRESS]
```

Example:
```bash
./revoke-authorities.sh \
  52RXuXrTNBDwvvsoQT4hrA6Xg5CHaLbirAmPuxxGNUtk \
  CVmin7GsgMp3Yju7XtCYvfRX41TW7652MqZAqiQMLQwT \
  5eSuYgfkPsQ32fA4mfZ2AKvsGmi4SyGwKXPbehEc2yjW
```

### Option 3: Using Environment Variables

```bash
export MINT_ADDRESS="52RXuXrTNBDwvvsoQT4hrA6Xg5CHaLbirAmPuxxGNUtk"
export STATE_PDA="CVmin7GsgMp3Yju7XtCYvfRX41TW7652MqZAqiQMLQwT"
export METADATA_ADDRESS="5eSuYgfkPsQ32fA4mfZ2AKvsGmi4SyGwKXPbehEc2yjW"  # Optional
export NETWORK="https://api.devnet.solana.com"  # Optional

./revoke-authorities.sh
```

## What the Script Does

1. **Validates prerequisites** (Anchor, Yarn, ts-node)
2. **Builds the program** if IDL is missing
3. **Revokes Mint Authority** via your Anchor program
   - Calls `revokeMintAuthority()` function
   - Sets mint authority to `null` (irreversible)
4. **Revokes Update Authority** via Metaplex Token Metadata program
   - Sets metadata update authority to `null` (irreversible)
5. **Verifies** both authorities were revoked

## Testing Steps

### Step 1: Check Current Authorities (Before)

Before running the script, verify the current state:

```bash
# Check mint authority
spl-token display <MINT_ADDRESS> --url <NETWORK>

# Or check the mint account directly
solana account <MINT_ADDRESS> --url <NETWORK> --output json | jq '.account.data[0]'
```

You should see:
- **Mint Authority**: A public key (not null)
- **Update Authority**: A public key (not null)

### Step 2: Run the Script

```bash
# Make sure you're in the project root
cd /path/to/spl-project

# Run the script
./revoke-authorities.sh
```

Expected output:
```
🔐 Revoking Mint and Update Authorities
=====================================

ℹ️  Checking prerequisites...
✅ Prerequisites check passed
ℹ️  Running revoke-authorities script...

📡 Network: https://api.devnet.solana.com
👛 Wallet: YourWalletAddress...

📋 Configuration:
   Mint: 52RXuXrTNBDwvvsoQT4hrA6Xg5CHaLbirAmPuxxGNUtk
   State PDA: CVmin7GsgMp3Yju7XtCYvfRX41TW7652MqZAqiQMLQwT
   Program ID: Gdcm1yXvSNjvLNWUdi7XfghXhatjrkWB8EHbtUpmPkUL

1️⃣ Revoking Mint Authority...
   ✅ Mint authority revoked!
   📝 Transaction: <transaction_signature>

2️⃣ Revoking Update Authority (Metadata)...
   📍 Metadata PDA: 5eSuYgfkPsQ32fA4mfZ2AKvsGmi4SyGwKXPbehEc2yjW
   ✅ Update authority revoked!
   📝 Transaction: <transaction_signature>

3️⃣ Verifying authorities...
   ✅ Mint authority: REVOKED (null)
   ✅ Update authority: Checked (verify manually with: spl-token display <MINT>)

✅ Done! Both authorities have been revoked.
```

### Step 3: Verify Authorities Were Revoked (After)

After running the script, verify the authorities are null:

#### Method 1: Using spl-token CLI

```bash
spl-token display <MINT_ADDRESS> --url <NETWORK>
```

Look for:
- **Mint Authority**: Should show as `null` or empty
- **Update Authority**: Should show as `null` or empty

#### Method 2: Using Solana CLI

```bash
# Get mint account info
solana account <MINT_ADDRESS> --url <NETWORK> --output json | jq '.account.data[0]'
```

The mint authority bytes (first 32 bytes) should be all zeros.

#### Method 3: Using Solscan/Solana Explorer

1. Go to [Solscan](https://solscan.io/) or [Solana Explorer](https://explorer.solana.com/)
2. Search for your mint address
3. Check the "Mint Authority" field - should be `null`
4. Check the metadata "Update Authority" field - should be `null`

#### Method 4: Programmatic Verification

Create a test script to verify:

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const mintAddress = new PublicKey("YOUR_MINT_ADDRESS");

const mintInfo = await getMint(connection, mintAddress);
console.log("Mint Authority:", mintInfo.mintAuthority?.toString() || "null (revoked)");
```

## Expected Results

### ✅ Success Indicators

- Script completes without errors
- Both transactions are confirmed
- Mint authority shows as `null`
- Update authority shows as `null`
- Token supply is now fixed (cannot mint more tokens)
- Metadata cannot be updated

### ❌ Common Issues

#### Issue: "MINT_ADDRESS is required"
**Solution**: Provide the mint address via:
- Command line argument
- Environment variable
- `deployment-info.json` file

#### Issue: "IDL not found"
**Solution**: Run `anchor build` first to generate the IDL

#### Issue: "Wallet not found"
**Solution**: 
- Set `ANCHOR_WALLET` environment variable
- Or ensure wallet is at `~/.config/solana/phantom.json`

#### Issue: "Insufficient funds"
**Solution**: Fund your wallet with SOL for transaction fees

#### Issue: "Update authority revocation failed"
**Possible causes**:
- Update authority is already revoked
- Wallet doesn't have update authority
- Metadata account doesn't exist

**Solution**: Check if update authority is already null, or verify wallet has the authority

## Important Warnings

⚠️ **IRREVERSIBLE ACTIONS**: 
- Once mint authority is revoked, you **cannot** mint more tokens
- Once update authority is revoked, you **cannot** update metadata
- These actions are **permanent** and **cannot be undone**

⚠️ **BEFORE REVOKING**:
- Ensure you've minted all tokens you need
- Ensure metadata is correct and final
- Test on devnet first before mainnet
- Keep backups of all important data

## Testing Checklist

- [ ] Prerequisites installed (Anchor, Yarn, Solana CLI)
- [ ] Program built (`anchor build`)
- [ ] Wallet configured and funded
- [ ] Deployment info available (or arguments provided)
- [ ] Current authorities verified (before)
- [ ] Script executed successfully
- [ ] Mint authority verified as null (after)
- [ ] Update authority verified as null (after)
- [ ] Attempted to mint (should fail)
- [ ] Attempted to update metadata (should fail)

## Additional Testing

### Test 1: Attempt to Mint After Revocation

```bash
# This should fail
anchor run mint-tokens --amount 1000
```

Expected: Error indicating mint authority is null

### Test 2: Attempt to Update Metadata

```bash
# This should fail
metaboss update data --keypair <wallet> --mint <MINT> --name "New Name"
```

Expected: Error indicating update authority is null

### Test 3: Verify Token Still Works

The token should still function normally:
- ✅ Transfers work
- ✅ Burns work
- ✅ Balances are correct
- ❌ Minting doesn't work (expected)
- ❌ Metadata updates don't work (expected)

## Troubleshooting

If you encounter issues, check:

1. **Transaction Logs**: Look at the transaction signatures in Solscan
2. **Program Logs**: Check Anchor program logs for errors
3. **Network**: Ensure you're on the correct network (devnet/mainnet)
4. **Wallet**: Verify wallet has the required authorities
5. **State PDA**: Ensure state PDA is correct and has mint authority

## Support

For issues or questions:
1. Check transaction logs on Solscan
2. Review Anchor program logs
3. Verify all prerequisites are met
4. Ensure wallet has sufficient SOL and correct authorities

