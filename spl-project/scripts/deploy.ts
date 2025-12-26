import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NcToken } from "../target/types/nc_token";
import { MultisigGovernance } from "../target/types/multisig_governance";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
import * as fs from "fs";
import * as path from "path";

// Token configuration
const TOKEN_NAME = "NC Token";
const TOKEN_SYMBOL = "NC";
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000_000; // 100 billion
const INITIAL_SUPPLY = 100_000_000; // 100 million

async function main() {
  console.log("🚀 Starting NC Token Deployment...\n");

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

  // Load programs
  const ncTokenProgram = anchor.workspace.ncToken as Program<NcToken>;
  const governanceProgram = anchor.workspace
    .multisigGovernance as Program<MultisigGovernance>;

  console.log("📦 NC Token Program ID:", ncTokenProgram.programId.toString());
  console.log(
    "📦 Governance Program ID:",
    governanceProgram.programId.toString()
  );
  console.log("");

  // Derive PDAs
  const [ncTokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nc_token_state")],
    ncTokenProgram.programId
  );

  const [governancePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    governanceProgram.programId
  );

  console.log("📍 NC Token State PDA:", ncTokenStatePda.toString());
  console.log("📍 Governance PDA:", governancePda.toString());
  console.log("");

  // Step 1: Initialize Governance
  console.log("1️⃣ Initializing MultiSig Governance...");
  try {
    const initGovTx = await governanceProgram.methods
      .initialize()
      .accounts({
        governance: governancePda,
        authority: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   ✅ Governance initialized:", initGovTx);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("   ℹ️  Governance already initialized, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 2: Initialize NC Token
  console.log("2️⃣ Initializing NC Token...");
  
  // For now, use governance PDA as governance address
  // In production, you'd use the actual governance program ID
  const bridge = walletKeypair.publicKey; // Placeholder
  const treasury = walletKeypair.publicKey; // Placeholder
  const bond = walletKeypair.publicKey; // Placeholder

  try {
    const initTokenTx = await ncTokenProgram.methods
      .initialize(governanceProgram.programId, bridge, treasury, bond)
      .accounts({
        state: ncTokenStatePda,
        authority: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   ✅ NC Token initialized:", initTokenTx);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("   ℹ️  NC Token already initialized, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 3: Set token in governance
  console.log("3️⃣ Setting token in governance...");
  try {
    const setTokenTx = await governanceProgram.methods
      .setToken(ncTokenProgram.programId)
      .accounts({
        governance: governancePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();
    console.log("   ✅ Token set in governance:", setTokenTx);
  } catch (err: any) {
    if (err.message?.includes("already set")) {
      console.log("   ℹ️  Token already set, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 4: Create token mint
  console.log("4️⃣ Creating token mint...");
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: walletKeypair.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      TOKEN_DECIMALS,
      walletKeypair.publicKey, // Initial mint authority
      null // Freeze authority
    )
  );

  await sendAndConfirmTransaction(
    connection,
    createMintTx,
    [walletKeypair, mintKeypair],
    { commitment: "confirmed" }
  );
  console.log("   ✅ Mint created:", mintKeypair.publicKey.toString());
  console.log("");

  // Step 5: Create metadata
  console.log("5️⃣ Creating token metadata...");
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  // Create metadata instruction (simplified - you may want to use Metaplex SDK)
  console.log("   📍 Metadata PDA:", metadataPda.toString());
  console.log("   ⚠️  Metadata creation skipped (use Metaplex tools)");
  console.log("");

  // Step 6: Mint initial supply
  console.log("6️⃣ Minting initial supply...");
  const tokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    walletKeypair.publicKey
  );

  // Create token account if needed
  try {
    const createTokenAccountTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        tokenAccount,
        walletKeypair.publicKey,
        mintKeypair.publicKey
      )
    );
    await sendAndConfirmTransaction(
      connection,
      createTokenAccountTx,
      [walletKeypair],
      { commitment: "confirmed" }
    );
    console.log("   ✅ Token account created");
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("   ℹ️  Token account already exists");
    }
  }

  // Mint initial supply
  const mintAmount = BigInt(INITIAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
  const mintTx = new Transaction().add(
    createMintToInstruction(
      mintKeypair.publicKey,
      tokenAccount,
      walletKeypair.publicKey,
      Number(mintAmount)
    )
  );

  await sendAndConfirmTransaction(connection, mintTx, [walletKeypair], {
    commitment: "confirmed",
  });
  console.log("   ✅ Initial supply minted:", INITIAL_SUPPLY, "tokens");
  console.log("");

  // Step 7: Transfer mint authority to NC Token program (optional - for program-controlled minting)
  console.log("7️⃣ Transferring mint authority...");
  const setAuthorityTx = new Transaction().add(
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      walletKeypair.publicKey,
      AuthorityType.MintTokens,
      ncTokenStatePda // Transfer to NC Token state PDA
    )
  );

  await sendAndConfirmTransaction(
    connection,
    setAuthorityTx,
    [walletKeypair],
    { commitment: "confirmed" }
  );
  console.log("   ✅ Mint authority transferred to NC Token state PDA");
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    ncTokenProgramId: ncTokenProgram.programId.toString(),
    governanceProgramId: governanceProgram.programId.toString(),
    mint: mintKeypair.publicKey.toString(),
    metadata: metadataPda.toString(),
    ncTokenStatePda: ncTokenStatePda.toString(),
    governancePda: governancePda.toString(),
    tokenAccount: tokenAccount.toString(),
    totalSupply: TOTAL_SUPPLY,
    initialSupply: INITIAL_SUPPLY,
    decimals: TOKEN_DECIMALS,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    network: connection.rpcEndpoint,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("✅ Deployment complete!");
  console.log("\n📋 Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  console.log("\n💡 Next steps:");
  console.log("   1. Set required approvals in governance");
  console.log("   2. Add signers to governance");
  console.log("   3. Configure bridge, treasury, and bond addresses");
  console.log("   4. Create metadata using Metaplex tools");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});
