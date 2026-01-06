import * as anchor from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  PublicKey,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * This script displays the presale token vault ATA address
 * where the admin should transfer tokens after deployment.
 */

async function main() {
  console.log("📍 Getting Presale Token Vault Address...\n");

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Get presale token mint
  const presaleTokenMintStr =
    process.argv[2] || process.env.PRESALE_TOKEN_MINT;

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
    // Try to load from Anchor workspace
    try {
      anchor.setProvider(anchor.AnchorProvider.env());
      const presaleProgram = anchor.workspace.presale;
      if (presaleProgram) {
        presaleProgramId = presaleProgram.programId;
      } else {
        throw new Error("Presale program not found in workspace");
      }
    } catch (error) {
      throw new Error(
        "Presale deployment info not found. Please run deploy-presale.ts first or provide PRESALE_PROGRAM_ID env variable."
      );
    }
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

  console.log("📋 Presale Token Vault Information:");
  console.log("   Presale Program ID:", presaleProgramId.toString());
  console.log("   Presale Token Mint:", presaleTokenMint.toString());
  console.log("   Vault PDA (owner):", presaleTokenVaultPda.toString());
  console.log("   Vault ATA (token account):", presaleTokenVaultAta.toString());
  console.log("");
  console.log("💡 Transfer tokens to this ATA address:");
  console.log(`   ${presaleTokenVaultAta.toString()}`);
  console.log("");
  console.log("📝 Example transfer command:");
  console.log(`   ts-node scripts/transfer-tokens-to-vault.ts <AMOUNT> ${presaleTokenMint.toString()}`);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
