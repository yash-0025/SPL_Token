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
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";

describe("NC Token & Governance", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ncTokenProgram = anchor.workspace.ncToken as Program<NcToken>;
  const governanceProgram = anchor.workspace
    .multisigGovernance as Program<MultisigGovernance>;
  const connection = provider.connection;

  // Test accounts
  let authority: Keypair;
  let user: Keypair;
  let recipient: Keypair;
  let signer1: Keypair;
  let signer2: Keypair;
  let mint: Keypair;
  let bridge: Keypair;
  let treasury: Keypair;
  let bond: Keypair;
  let liquidityPool: Keypair;

  let ncTokenStatePda: PublicKey;
  let governancePda: PublicKey;
  let userTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;
  let liquidityPoolTokenAccount: PublicKey;

  // Test constants
  const MINT_DECIMALS = 9;
  const INITIAL_SUPPLY = 1000 * 10 ** MINT_DECIMALS; // 1000 tokens
  const TRANSFER_AMOUNT = 100 * 10 ** MINT_DECIMALS; // 100 tokens
  const SELL_AMOUNT = 60 * 10 ** MINT_DECIMALS; // 60 tokens (6% - should fail)

  before(async () => {
    // Generate keypairs for testing
    authority = Keypair.generate();
    user = Keypair.generate();
    recipient = Keypair.generate();
    signer1 = Keypair.generate();
    signer2 = Keypair.generate();
    mint = Keypair.generate();
    bridge = Keypair.generate();
    treasury = Keypair.generate();
    bond = Keypair.generate();
    liquidityPool = Keypair.generate();

    // Airdrop SOL to test accounts
    const airdropAmount = 2 * anchor.web3.LAMPORTS_PER_SOL;
    const accounts = [
      authority,
      user,
      recipient,
      signer1,
      signer2,
      bridge,
      treasury,
      bond,
      liquidityPool,
    ];
    for (const account of accounts) {
      await provider.connection.requestAirdrop(
        account.publicKey,
        airdropAmount
      );
    }

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Derive PDAs
    [ncTokenStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("nc_token_state")],
      ncTokenProgram.programId
    );

    [governancePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("governance")],
      governanceProgram.programId
    );

    // Get associated token addresses
    userTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      user.publicKey
    );
    recipientTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      recipient.publicKey
    );
    liquidityPoolTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      liquidityPool.publicKey
    );
  });

  describe("Governance", () => {
    it("Initializes governance", async () => {
      const tx = await governanceProgram.methods
        .initialize()
        .accounts({
          governance: governancePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const governance = await governanceProgram.account.governance.fetch(
        governancePda
      );
      expect(governance.cooldownPeriod.toNumber()).to.equal(90 * 60);
      expect(governance.requiredApprovals).to.equal(1);
      expect(governance.tokenSet).to.be.false;
    });

    it("Sets token in governance", async () => {
      const tx = await governanceProgram.methods
        .setToken(ncTokenProgram.programId)
        .accounts({
          governance: governancePda,
          authority: authority.publicKey,
        })
        .rpc();

      const governance = await governanceProgram.account.governance.fetch(
        governancePda
      );
      expect(governance.tokenSet).to.be.true;
      expect(governance.ncToken.toString()).to.equal(
        ncTokenProgram.programId.toString()
      );
    });

    it("Sets required approvals", async () => {
      const tx = await governanceProgram.methods
        .setRequiredApprovals(3)
        .accounts({
          governance: governancePda,
          authority: authority.publicKey,
        })
        .rpc();

      const governance = await governanceProgram.account.governance.fetch(
        governancePda
      );
      expect(governance.requiredApprovals).to.equal(3);
    });
  });

  describe("NC Token", () => {
    it("Initializes NC Token", async () => {
      const tx = await ncTokenProgram.methods
        .initialize(
          governanceProgram.programId,
          bridge.publicKey,
          treasury.publicKey,
          bond.publicKey
        )
        .accounts({
          state: ncTokenStatePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const state = await ncTokenProgram.account.nCTokenState.fetch(
        ncTokenStatePda
      );
      expect(state.governance.toString()).to.equal(
        governanceProgram.programId.toString()
      );
      expect(state.bridge.toString()).to.equal(bridge.publicKey.toString());
      expect(state.treasury.toString()).to.equal(treasury.publicKey.toString());
      expect(state.bond.toString()).to.equal(bond.publicKey.toString());
      expect(state.emergencyPaused).to.be.false;
    });

    it("Creates token mint and mints initial supply", async () => {
      // Create mint
      const mintRent = await getMinimumBalanceForRentExemptMint(connection);
      const createMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mint.publicKey,
          MINT_DECIMALS,
          authority.publicKey,
          null
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createMintTx,
        [authority, mint],
        { commitment: "confirmed" }
      );

      // Create token account
      const createTokenAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          userTokenAccount,
          user.publicKey,
          mint.publicKey
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createTokenAccountTx,
        [authority],
        { commitment: "confirmed" }
      );

      // Mint initial supply
      const mintTx = new Transaction().add(
        createMintToInstruction(
          mint.publicKey,
          userTokenAccount,
          authority.publicKey,
          INITIAL_SUPPLY
        )
      );

      await sendAndConfirmTransaction(connection, mintTx, [authority], {
        commitment: "confirmed",
      });

      const account = await getAccount(connection, userTokenAccount);
      expect(account.amount.toString()).to.equal(INITIAL_SUPPLY.toString());
    });
  });

  describe("Transfer Rules", () => {
    it("Allows normal P2P transfer", async () => {
      // Create recipient token account
      const createTokenAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          recipientTokenAccount,
          recipient.publicKey,
          mint.publicKey
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createTokenAccountTx,
        [user],
        { commitment: "confirmed" }
      );

      // Transfer via NC Token program
      const tx = await ncTokenProgram.methods
        .transfer(new anchor.BN(TRANSFER_AMOUNT))
        .accounts({
          state: ncTokenStatePda,
          mint: mint.publicKey,
          fromAccount: userTokenAccount,
          toAccount: recipientTokenAccount,
          fromAuthority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const recipientAccount = await getAccount(
        connection,
        recipientTokenAccount
      );
      expect(recipientAccount.amount.toString()).to.equal(
        TRANSFER_AMOUNT.toString()
      );
    });

    it("Enforces 5% sell limit when selling to liquidity pool", async () => {
      // Set liquidity pool
      const setPoolTx = await governanceProgram.methods
        .setLiquidityPool(liquidityPool.publicKey, true)
        .accounts({
          governance: governancePda,
          authority: signer1.publicKey,
        })
        .rpc();

      // Approve transaction
      await governanceProgram.methods
        .approveTransaction(new anchor.BN(1))
        .accounts({
          governance: governancePda,
          proposal: governancePda, // Simplified
          approver: signer2.publicKey,
        })
        .rpc();

      // Create liquidity pool token account
      const createPoolAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          liquidityPoolTokenAccount,
          liquidityPool.publicKey,
          mint.publicKey
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createPoolAccountTx,
        [user],
        { commitment: "confirmed" }
      );

      // Get current balance
      const userAccount = await getAccount(connection, userTokenAccount);
      const currentBalance = userAccount.amount;
      const maxSell = (currentBalance * BigInt(5)) / BigInt(100); // 5%

      // Try to sell more than 5% - should fail
      try {
        await ncTokenProgram.methods
          .transfer(new anchor.BN(SELL_AMOUNT))
          .accounts({
            state: ncTokenStatePda,
            mint: mint.publicKey,
            fromAccount: userTokenAccount,
            toAccount: liquidityPoolTokenAccount,
            fromAuthority: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed with sell limit exceeded");
      } catch (err: any) {
        expect(err.message).to.include("SellLimitExceeded");
      }

      // Sell exactly 5% - should succeed
      const validSellAmount = Number(maxSell);
      await ncTokenProgram.methods
        .transfer(new anchor.BN(validSellAmount))
        .accounts({
          state: ncTokenStatePda,
          mint: mint.publicKey,
          fromAccount: userTokenAccount,
          toAccount: liquidityPoolTokenAccount,
          fromAuthority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("Blocks blacklisted addresses from interacting with restricted addresses", async () => {
      // Blacklist user
      const blacklistTx = await governanceProgram.methods
        .setBlacklist(user.publicKey, true)
        .accounts({
          governance: governancePda,
          authority: signer1.publicKey,
        })
        .rpc();

      // Set bridge as restricted
      const restrictTx = await governanceProgram.methods
        .setRestricted(bridge.publicKey, true)
        .accounts({
          governance: governancePda,
          authority: signer1.publicKey,
        })
        .rpc();

      // Try to transfer from blacklisted user to restricted address - should fail
      try {
        const bridgeTokenAccount = await getAssociatedTokenAddress(
          mint.publicKey,
          bridge.publicKey
        );

        await ncTokenProgram.methods
          .transfer(new anchor.BN(TRANSFER_AMOUNT))
          .accounts({
            state: ncTokenStatePda,
            mint: mint.publicKey,
            fromAccount: userTokenAccount,
            toAccount: bridgeTokenAccount,
            fromAuthority: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed - blacklisted cannot interact with restricted");
      } catch (err: any) {
        expect(err.message).to.include("Blacklisted");
      }

      // But blacklisted user can still do normal P2P transfer
      const normalRecipient = Keypair.generate();
      const normalRecipientTokenAccount = await getAssociatedTokenAddress(
        mint.publicKey,
        normalRecipient.publicKey
      );

      // This should succeed
      await ncTokenProgram.methods
        .transfer(new anchor.BN(TRANSFER_AMOUNT))
        .accounts({
          state: ncTokenStatePda,
          mint: mint.publicKey,
          fromAccount: userTokenAccount,
          toAccount: normalRecipientTokenAccount,
          fromAuthority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("Emergency pause only freezes protocol modules, not P2P transfers", async () => {
      // Set emergency pause
      const pauseTx = await governanceProgram.methods
        .setEmergencyPause()
        .accounts({
          governance: governancePda,
          ncTokenProgram: ncTokenProgram.programId,
          ncTokenState: ncTokenStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      const state = await ncTokenProgram.account.nCTokenState.fetch(
        ncTokenStatePda
      );
      expect(state.emergencyPaused).to.be.true;

      // P2P transfer should still work
      const normalUser = Keypair.generate();
      const normalUserTokenAccount = await getAssociatedTokenAddress(
        mint.publicKey,
        normalUser.publicKey
      );

      await ncTokenProgram.methods
        .transfer(new anchor.BN(TRANSFER_AMOUNT))
        .accounts({
          state: ncTokenStatePda,
          mint: mint.publicKey,
          fromAccount: userTokenAccount,
          toAccount: normalUserTokenAccount,
          fromAuthority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // But interaction with restricted address should fail
      try {
        const bridgeTokenAccount = await getAssociatedTokenAddress(
          mint.publicKey,
          bridge.publicKey
        );

        await ncTokenProgram.methods
          .transfer(new anchor.BN(TRANSFER_AMOUNT))
          .accounts({
            state: ncTokenStatePda,
            mint: mint.publicKey,
            fromAccount: userTokenAccount,
            toAccount: bridgeTokenAccount,
            fromAuthority: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed - paused");
      } catch (err: any) {
        expect(err.message).to.include("Paused");
      }
    });
  });
});

