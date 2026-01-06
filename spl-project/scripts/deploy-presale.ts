import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🚀 Starting Presale Contract Deployment...\n");

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

  // Setup Anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load presale program
  let presaleProgram: Program<Presale>;
  try {
    presaleProgram = anchor.workspace.presale as Program<Presale>;
    console.log("📦 Presale Program ID:", presaleProgram.programId.toString());
  } catch (error) {
    console.error("❌ Error loading presale program from workspace");
    console.error("   Make sure to run 'anchor build' first");
    throw error;
  }

  // Load deployment info to get the token mint
  let deploymentInfo: any = {};
  const deploymentInfoPath = path.join(__dirname, "..", "deployment-info.json");
  if (fs.existsSync(deploymentInfoPath)) {
    deploymentInfo = JSON.parse(fs.readFileSync(deploymentInfoPath, "utf-8"));
    console.log("📋 Loaded deployment info");
    console.log("   Token Mint:", deploymentInfo.mint);
  } else {
    console.log("⚠️  deployment-info.json not found");
    console.log("   You'll need to provide the presale token mint address");
  }

  // Get presale token mint from args or deployment info
  const presaleTokenMintStr =
    process.argv[2] || deploymentInfo.mint || process.env.PRESALE_TOKEN_MINT;
  if (!presaleTokenMintStr) {
    throw new Error(
      "Please provide presale token mint address as argument or set PRESALE_TOKEN_MINT env variable"
    );
  }
  const presaleTokenMint = new PublicKey(presaleTokenMintStr);

  console.log("🎯 Presale Token Mint:", presaleTokenMint.toString());
  console.log("");

  // Derive PDAs
  const [presaleStatePda, presaleStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    presaleProgram.programId
  );

  // Derive the PDA that will own the token vault ATA
  const [presaleTokenVaultPda, presaleTokenVaultBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("presale_token_vault_pda"), presaleTokenMint.toBuffer()],
      presaleProgram.programId
    );

  // Derive the ATA address for the presale token vault
  const presaleTokenVaultAta = await getAssociatedTokenAddress(
    presaleTokenMint,
    presaleTokenVaultPda,
    true // allowOwnerOffCurve = true for PDA
  );

  console.log("📍 Presale State PDA:", presaleStatePda.toString());
  console.log("📍 Presale Token Vault PDA (owner):", presaleTokenVaultPda.toString());
  console.log("📍 Presale Token Vault ATA (token account):", presaleTokenVaultAta.toString());
  console.log("");

  // Step 1: Initialize Presale Contract
  console.log("1️⃣ Initializing Presale Contract...");
  try {
    const initTx = await presaleProgram.methods
      .initialize(walletKeypair.publicKey, presaleTokenMint)
      .accounts({
        presaleState: presaleStatePda,
        payer: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Presale initialized:", initTx);
    console.log("   📍 Admin:", walletKeypair.publicKey.toString());
  } catch (err: any) {
    if (err.message?.includes("already in use") || err.message?.includes("AccountDiscriminatorAlreadyExists")) {
      console.log("   ℹ️  Presale already initialized, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 2: Create Presale Token Vault ATA (if it doesn't exist)
  console.log("2️⃣ Creating Presale Token Vault ATA...");
  try {
    await getAccount(connection, presaleTokenVaultAta);
    console.log("   ℹ️  Presale token vault ATA already exists");
  } catch (error: any) {
    if (error.message?.includes("could not find account")) {
      console.log("   📝 Creating ATA for presale token vault...");
      
      // Create the ATA instruction
      // Note: For PDA-owned ATAs, we need to use the PDA as the owner
      const createVaultIx = createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey, // payer
        presaleTokenVaultAta, // ata address
        presaleTokenVaultPda, // owner (PDA)
        presaleTokenMint // mint
      );

      // We need to sign with the PDA, so we'll need to include it in the transaction
      // and use the program to sign
      const createVaultTx = new anchor.web3.Transaction().add(createVaultIx);

      try {
        const signature = await anchor.web3.sendAndConfirmTransaction(
          connection,
          createVaultTx,
          [walletKeypair],
          { commitment: "confirmed" }
        );
        console.log("   ✅ Presale token vault ATA created:", signature);
      } catch (createError: any) {
        console.log("   ⚠️  Could not create ATA automatically");
        console.log("   💡 The ATA will be created automatically when you transfer tokens to it");
        console.log("   📍 ATA Address:", presaleTokenVaultAta.toString());
      }
    } else {
      throw error;
    }
  }
  console.log("");

  // Step 3: Display important information
  console.log("✅ Deployment complete!");
  console.log("\n📋 Presale Contract Info:");
  const presaleInfo = {
    presaleProgramId: presaleProgram.programId.toString(),
    presaleStatePda: presaleStatePda.toString(),
    presaleTokenMint: presaleTokenMint.toString(),
    presaleTokenVaultPda: presaleTokenVaultPda.toString(),
    presaleTokenVaultAta: presaleTokenVaultAta.toString(),
    admin: walletKeypair.publicKey.toString(),
    network: connection.rpcEndpoint,
    deployedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(presaleInfo, null, 2));
  console.log("\n💡 Next steps:");
  console.log("   1. Transfer presale tokens to the vault ATA:");
  console.log(`      Vault ATA Address: ${presaleTokenVaultAta.toString()}`);
  console.log("      Use: ts-node scripts/transfer-tokens-to-vault.ts <AMOUNT>");
  console.log("   2. Allow payment tokens (USDC, USDT, etc.) using allow_payment_token");
  console.log("   3. Start the presale using start_presale");
  console.log("\n📝 To get the vault address for token transfer, run:");
  console.log("   ts-node scripts/get-presale-vault-address.ts");

  // Save presale deployment info
  const presaleDeploymentPath = path.join(
    __dirname,
    "..",
    "presale-deployment-info.json"
  );
  fs.writeFileSync(
    presaleDeploymentPath,
    JSON.stringify(presaleInfo, null, 2)
  );
  console.log(`\n💾 Presale info saved to: ${presaleDeploymentPath}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});

