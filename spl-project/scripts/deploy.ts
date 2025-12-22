import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../target/types/spl_project";
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
  MintLayout,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
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
const TOKEN_NAME = "NC";
const TOKEN_SYMBOL = "NC";
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000_000; // 100 billion

async function main() {
  console.log("🚀 Starting deployment...\n");

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Load wallet
  const walletPath =
    process.env.ANCHOR_WALLET || path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "solana", "phantom.json");
  
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}. Please set ANCHOR_WALLET environment variable.`);
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

  // Load program
  const program = anchor.workspace.splProject as Program<SplProject>;
  console.log("📦 Program ID:", program.programId.toString());
  console.log("");

  // Derive state PDA
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );
  console.log("📍 State PDA:", statePda.toString());
  console.log("");

  // Step 1: Initialize program state
  console.log("1️⃣ Initializing program state...");
  try {
    const initTx = await program.methods
      .initialize()
      .accountsPartial({
        authority: walletKeypair.publicKey,
      })
      .rpc();
    console.log("   ✅ State initialized:", initTx);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("   ℹ️  State already initialized, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 2: Create mint account
  console.log("2️⃣ Creating token mint...");
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
      walletKeypair.publicKey, // Temporary authority (will transfer to state PDA)
      null // No freeze authority
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

  // Step 3: Create metadata using CreateMetadataAccountV3 (V2 is deprecated)
  console.log("3️⃣ Creating token metadata...");
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  // Helper to serialize string with u32 length prefix (Borsh format)
  const serializeString = (str: string): Buffer => {
    const strBytes = Buffer.from(str, "utf8");
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(strBytes.length, 0);
    return Buffer.concat([len, strBytes]);
  };

  // CreateMetadataAccountV3 instruction discriminator = 33
  const discriminator = Buffer.from([33]);
  
  // Serialize DataV2 struct (Borsh format for V3)
  const nameBytes = serializeString(TOKEN_NAME);
  const symbolBytes = serializeString(TOKEN_SYMBOL);
  const uriBytes = serializeString(""); // Empty URI
  
  // DataV2 struct: name, symbol, uri, seller_fee_basis_points, creators, collection, uses
  const dataV2Parts: Buffer[] = [
    nameBytes,                    // name: String
    symbolBytes,                  // symbol: String
    uriBytes,                     // uri: String
    Buffer.from([0, 0]),         // seller_fee_basis_points: u16 (little-endian)
    Buffer.from([0]),            // creators: Option<Vec<Creator>> - None
    Buffer.from([0]),            // collection: Option<Collection> - None
    Buffer.from([0]),            // uses: Option<Uses> - None
  ];
  const dataV2 = Buffer.concat(dataV2Parts);
  
  // CreateMetadataAccountArgsV3: data (DataV2), is_mutable (bool), collection_details (Option)
  const argsV3 = Buffer.concat([
    dataV2,                       // data: DataV2
    Buffer.from([1]),             // is_mutable: bool (true)
    Buffer.from([0]),             // collection_details: Option<CollectionDetails> - None
  ]);
  
  // Full instruction: discriminator + args
  const instructionData = Buffer.concat([discriminator, argsV3]);

  // Rent sysvar
  const rentSysvar = new PublicKey("SysvarRent111111111111111111111111111111111");
  
  // CreateMetadataAccountV3 account order:
  // 0. metadata (writable)
  // 1. mint (readonly)
  // 2. mint_authority (signer)
  // 3. payer (writable, signer)
  // 4. update_authority (readonly)
  // 5. system_program (readonly)
  // 6. rent (readonly)
  const metadataInstruction = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: rentSysvar, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  try {
    const metadataTx = new Transaction().add(metadataInstruction);
    await sendAndConfirmTransaction(
      connection,
      metadataTx,
      [walletKeypair],
      { commitment: "confirmed" }
    );
    console.log("   ✅ Metadata created:", metadataPda.toString());
    console.log("   📝 Name:", TOKEN_NAME);
    console.log("   🏷️  Symbol:", TOKEN_SYMBOL);
    console.log("");
  } catch (error: any) {
    console.error("   ❌ Metadata creation failed:", error.message);
    if (error.transactionLogs) {
      console.error("   Logs:", error.transactionLogs.join("\n"));
    }
    console.log("   ⚠️  Continuing without metadata - token will work but won't show name/symbol in wallets");
    console.log("   💡 You can add metadata later using Metaplex tools");
    console.log("");
  }

  // Step 4: Transfer mint authority to state PDA
  console.log("4️⃣ Transferring mint authority to state PDA...");
  const setAuthorityTx = new Transaction().add(
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      walletKeypair.publicKey,
      AuthorityType.MintTokens,
      statePda
    )
  );

  await sendAndConfirmTransaction(
    connection,
    setAuthorityTx,
    [walletKeypair],
    { commitment: "confirmed" }
  );
  console.log("   ✅ Mint authority transferred to state PDA");
  console.log("");

  // Step 5: Create token account for initial supply
  console.log("5️⃣ Creating token account...");
  const tokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    walletKeypair.publicKey
  );

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
  console.log("   ✅ Token account created:", tokenAccount.toString());
  console.log("");

  // Step 6: Mint total supply
  console.log("6️⃣ Minting total supply (100 billion tokens)...");
  // Note: u64 max is 18,446,744,073,709,551,615
  // With 9 decimals, max tokens in a single account = 18,446,744,073,709,551,615 / 1,000,000,000 ≈ 18.4 billion
  // Since we want 100 billion, we need to use multiple token accounts or reduce supply
  // For now, we'll mint up to the u64 limit (about 18.4 billion tokens)
  
  const decimalsMultiplier = BigInt(1000000000); // 10^9
  const U64_MAX = BigInt("18446744073709551615");
  const MAX_TOKENS_PER_ACCOUNT = U64_MAX / decimalsMultiplier; // ~18.4 billion
  
  console.log(`   ⚠️  Note: u64 limit allows max ~${MAX_TOKENS_PER_ACCOUNT.toString()} tokens per account`);
  console.log(`   📦 Will mint up to the limit (${MAX_TOKENS_PER_ACCOUNT.toString()} tokens)...`);
  
  // Check current balance
  const { getAccount } = await import("@solana/spl-token");
  let currentBalance = BigInt(0);
  try {
    const accountInfo = await getAccount(connection, tokenAccount);
    currentBalance = BigInt(accountInfo.amount.toString());
    console.log(`   💰 Current balance: ${(currentBalance / decimalsMultiplier).toString()} tokens`);
  } catch (e) {
    console.log("   💰 Starting with 0 tokens");
  }
  
  const remainingCapacity = U64_MAX - currentBalance;
  const maxMintable = remainingCapacity / decimalsMultiplier;
  
  if (maxMintable <= 0) {
    console.log("   ⚠️  Account is already at maximum capacity!");
    console.log("   💡 To mint more tokens, you'll need to use additional token accounts");
  } else {
    const chunkSize = 1_000_000_000; // 1 billion tokens per chunk (safer)
    const tokensToMint = BigInt(Math.min(Number(maxMintable), TOTAL_SUPPLY));
    const chunks = Math.ceil(Number(tokensToMint) / chunkSize);
    
    console.log(`   📦 Minting ${tokensToMint.toString()} tokens in ${chunks} chunks of ${chunkSize.toLocaleString()} tokens each...`);
    
    for (let i = 0; i < chunks; i++) {
      const remaining = Number(tokensToMint) - (i * chunkSize);
      const currentChunk = Math.min(chunkSize, remaining);
      
      if (currentChunk <= 0) break;
      
      const chunkAmount = BigInt(currentChunk) * decimalsMultiplier;
      
      // Check if this would overflow
      if (currentBalance + chunkAmount > U64_MAX) {
        const finalAmount = U64_MAX - currentBalance;
        const finalTokens = Number(finalAmount / decimalsMultiplier);
        console.log(`   ⚠️  Reached u64 limit. Minting final ${finalTokens.toLocaleString()} tokens...`);
        
        const finalBN = new anchor.BN(finalAmount.toString());
        const mintTx = await program.methods
          .mintTokens(finalBN)
          .accountsPartial({
            mint: mintKeypair.publicKey,
            to: tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        console.log(`   ✅ Final chunk minted: ${mintTx}`);
        break;
      }
      
      const chunkBN = new anchor.BN(chunkAmount.toString());
      
      console.log(`   💰 Minting chunk ${i + 1}/${chunks}: ${currentChunk.toLocaleString()} tokens...`);
      
      try {
        const mintTx = await program.methods
          .mintTokens(chunkBN)
          .accountsPartial({
            mint: mintKeypair.publicKey,
            to: tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        console.log(`   ✅ Chunk ${i + 1} minted: ${mintTx}`);
        currentBalance += chunkAmount;
        
        // Small delay between transactions
        if (i < chunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        console.error(`   ❌ Failed to mint chunk ${i + 1}:`, error.message);
        if (error.message.includes("overflowed") || error.message.includes("0xe")) {
          console.log("   ⚠️  Account reached maximum capacity. Cannot mint more to this account.");
          break;
        }
        throw error;
      }
    }
    
    // Get final balance
    const finalAccountInfo = await getAccount(connection, tokenAccount);
    const finalBalance = BigInt(finalAccountInfo.amount.toString());
    const finalTokens = Number(finalBalance / decimalsMultiplier);
    
    console.log("   ✅ Minting completed!");
    console.log(`   💰 Final balance: ${finalTokens.toLocaleString()} tokens`);
    
    if (finalTokens < TOTAL_SUPPLY) {
      console.log(`   ⚠️  Note: Only ${finalTokens.toLocaleString()} tokens minted (max per account: ~${MAX_TOKENS_PER_ACCOUNT.toString()})`);
      console.log(`   💡 To mint the remaining ${(TOTAL_SUPPLY - finalTokens).toLocaleString()} tokens, create additional token accounts`);
    }
  }
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    programId: program.programId.toString(),
    mint: mintKeypair.publicKey.toString(),
    metadata: metadataPda.toString(),
    statePda: statePda.toString(),
    tokenAccount: tokenAccount.toString(),
    totalSupply: TOTAL_SUPPLY,
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
  console.log("");
  console.log("📋 Deployment Summary:");
  console.log("   Program ID:", deploymentInfo.programId);
  console.log("   Mint:", deploymentInfo.mint);
  console.log("   Metadata:", deploymentInfo.metadata);
  console.log("   State PDA:", deploymentInfo.statePda);
  console.log("   Token Account:", deploymentInfo.tokenAccount);
  console.log("   Total Supply:", deploymentInfo.totalSupply.toLocaleString());
  console.log("   Decimals:", deploymentInfo.decimals);
  console.log("   Name:", deploymentInfo.name);
  console.log("   Symbol:", deploymentInfo.symbol);
  console.log("");
  console.log("💾 Deployment info saved to: deployment-info.json");
}

main()
  .then(() => {
    console.log("✨ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });

