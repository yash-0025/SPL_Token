import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * This script helps the admin transfer presale tokens to the presale vault.
 * The vault is a PDA-owned token account that will hold tokens for the presale.
 */

async function main() {
  console.log("💰 Transferring Tokens to Presale Vault...\n");

  // Get arguments
  const amount = process.argv[2];
  if (!amount) {
    console.error("Usage: ts-node scripts/transfer-tokens-to-vault.ts <AMOUNT> [PRESALE_TOKEN_MINT]");
    console.error("Example: ts-node scripts/transfer-tokens-to-vault.ts 1000000000");
    process.exit(1);
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error("Invalid amount. Please provide a positive number.");
  }

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Load wallet
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "phantom.json"
    );

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet not found at ${walletPath}. Please set ANCHOR_WALLET environment variable.`
    );
  }

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("📝 Wallet:", walletKeypair.publicKey.toString());
  console.log("🌐 Network:", connection.rpcEndpoint);
  console.log("");

  // Get presale token mint
  const presaleTokenMintStr =
    process.argv[3] || process.env.PRESALE_TOKEN_MINT;

  let presaleTokenMint: PublicKey;
  if (presaleTokenMintStr) {
    presaleTokenMint = new PublicKey(presaleTokenMintStr);
  } else {
    // Try to load from deployment info
    const deploymentInfoPath = path.join(
      __dirname,
      "..",
      "deployment-info.json"
    );
    if (fs.existsSync(deploymentInfoPath)) {
      const deploymentInfo = JSON.parse(
        fs.readFileSync(deploymentInfoPath, "utf-8")
      );
      if (deploymentInfo.mint) {
        presaleTokenMint = new PublicKey(deploymentInfo.mint);
      } else {
        throw new Error(
          "Please provide presale token mint address as argument or set PRESALE_TOKEN_MINT env variable"
        );
      }
    } else {
      throw new Error(
        "Please provide presale token mint address as argument or set PRESALE_TOKEN_MINT env variable"
      );
    }
  }

  // Load presale program ID
  let presaleProgramId: PublicKey;
  const presaleDeploymentPath = path.join(
    __dirname,
    "..",
    "presale-deployment-info.json"
  );
  if (fs.existsSync(presaleDeploymentPath)) {
    const presaleInfo = JSON.parse(
      fs.readFileSync(presaleDeploymentPath, "utf-8")
    );
    presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);
  } else {
    throw new Error(
      "Presale deployment info not found. Please run deploy-presale.ts first."
    );
  }

  // Derive the presale token vault PDA (owner of the ATA)
  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_token_vault_pda"), presaleTokenMint.toBuffer()],
    presaleProgramId
  );

  // Derive the ATA address for the presale token vault
  const presaleTokenVaultAta = await getAssociatedTokenAddress(
    presaleTokenMint,
    presaleTokenVaultPda,
    true // allowOwnerOffCurve = true for PDA
  );

  console.log("🎯 Configuration:");
  console.log("   Presale Token Mint:", presaleTokenMint.toString());
  console.log("   Presale Token Vault PDA:", presaleTokenVaultPda.toString());
  console.log("   Presale Token Vault ATA:", presaleTokenVaultAta.toString());
  console.log("   Amount:", amountNum);
  console.log("");

  // Get admin's token account
  const adminTokenAccount = await getAssociatedTokenAddress(
    presaleTokenMint,
    walletKeypair.publicKey
  );

  // Check if admin has tokens
  try {
    const adminAccount = await getAccount(connection, adminTokenAccount);
    const decimals = 9; // Adjust based on your token decimals
    const amountWithDecimals = BigInt(Math.floor(amountNum * 10 ** decimals));
    
    if (adminAccount.amount < amountWithDecimals) {
      throw new Error(
        `Insufficient balance. You have ${adminAccount.amount.toString()} but need ${amountWithDecimals.toString()}`
      );
    }

    console.log("✅ Admin has sufficient balance");
    console.log("   Balance:", adminAccount.amount.toString());
    console.log("");

    // Check if vault ATA exists, if not, create it
    let vaultExists = false;
    try {
      await getAccount(connection, presaleTokenVaultAta);
      vaultExists = true;
      console.log("✅ Vault ATA already exists");
    } catch (error: any) {
      if (error.message?.includes("could not find account")) {
        console.log("⚠️  Vault ATA doesn't exist yet. Creating it...");
        
        // Create the ATA
        const createAtaIx = createAssociatedTokenAccountInstruction(
          walletKeypair.publicKey, // payer
          presaleTokenVaultAta, // ata address
          presaleTokenVaultPda, // owner (PDA)
          presaleTokenMint // mint
        );

        const createTx = new Transaction().add(createAtaIx);
        try {
          await sendAndConfirmTransaction(
            connection,
            createTx,
            [walletKeypair],
            { commitment: "confirmed" }
          );
          console.log("✅ Vault ATA created successfully");
          vaultExists = true;
        } catch (createError: any) {
          console.error("❌ Failed to create vault ATA:", createError.message);
          throw createError;
        }
      } else {
        throw error;
      }
    }

    if (vaultExists) {
      // Transfer tokens
      console.log("📤 Transferring tokens...");
      const transferInstruction = createTransferInstruction(
        adminTokenAccount,
        presaleTokenVaultAta,
        walletKeypair.publicKey,
        amountWithDecimals
      );

      const transaction = new Transaction().add(transferInstruction);
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [walletKeypair],
        { commitment: "confirmed" }
      );

      console.log("✅ Transfer successful!");
      console.log("   Signature:", signature);
      console.log("   Amount transferred:", amountWithDecimals.toString());
      console.log("   To vault ATA:", presaleTokenVaultAta.toString());
    }
  } catch (error: any) {
    if (error.message?.includes("could not find account")) {
      console.error("❌ Admin token account not found.");
      console.error("   Make sure you have tokens in your wallet.");
    } else {
      throw error;
    }
  }
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

