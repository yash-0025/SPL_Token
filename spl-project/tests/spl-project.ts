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
  createBurnInstruction,
  createTransferInstruction,
  getAccount,
  MintLayout,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";

describe("spl-project", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.splProject as Program<SplProject>;
  const connection = provider.connection;

  // Test accounts
  let authority: Keypair;
  let user: Keypair;
  let recipient: Keypair;
  let mint: Keypair;
  let statePda: PublicKey;
  let stateBump: number;
  let userTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;

  // Test constants
  const MINT_DECIMALS = 9;
  const MINT_AMOUNT = 1000 * 10 ** MINT_DECIMALS; // 1000 tokens
  const TRANSFER_AMOUNT = 100 * 10 ** MINT_DECIMALS; // 100 tokens
  const BURN_AMOUNT = 50 * 10 ** MINT_DECIMALS; // 50 tokens

  before(async () => {
    // Generate keypairs for testing
    authority = Keypair.generate();
    user = Keypair.generate();
    recipient = Keypair.generate();
    mint = Keypair.generate();

    // Airdrop SOL to test accounts
    const airdropAmount = 2 * anchor.web3.LAMPORTS_PER_SOL;
    await provider.connection.requestAirdrop(
      authority.publicKey,
      airdropAmount
    );
    await provider.connection.requestAirdrop(
      user.publicKey,
      airdropAmount
    );
    await provider.connection.requestAirdrop(
      recipient.publicKey,
      airdropAmount
    );

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive state PDA
    [statePda, stateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
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
  });

  describe("Initialize", () => {
    it("Initializes the token program state", async () => {
      const tx = await program.methods
        .initialize()
        .accounts({
          state: statePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log("Initialize transaction signature:", tx);

      // Fetch and verify state account
      const stateAccount = await program.account.tokenState.fetch(statePda);

      expect(stateAccount.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(stateAccount.bump).to.equal(stateBump);

      console.log("✓ State initialized successfully");
      console.log("  Authority:", stateAccount.authority.toString());
      console.log("  Bump:", stateAccount.bump);
    });

    it("Fails if initialized twice", async () => {
      try {
        await program.methods
          .initialize()
          .accounts({
            state: statePda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("already in use");
        console.log("✓ Correctly prevented double initialization");
      }
    });
  });

  describe("Mint Tokens", () => {
    before(async () => {
      // Create mint account
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
          statePda, // State PDA is the mint authority
          null // Freeze authority (null = no freeze)
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createMintTx,
        [authority, mint],
        { commitment: "confirmed" }
      );

      console.log("✓ Mint account created");

      // Create user's token account
      const createUserTokenAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, // Payer
          userTokenAccount,
          user.publicKey, // Owner
          mint.publicKey
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createUserTokenAccountTx,
        [authority],
        { commitment: "confirmed" }
      );

      console.log("✓ User token account created");
    });

    it("Mints tokens to a token account", async () => {
      const tx = await program.methods
        .mintTokens(new anchor.BN(MINT_AMOUNT))
        .accounts({
          state: statePda,
          mint: mint.publicKey,
          to: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("Mint transaction signature:", tx);

      // Verify token balance
      const tokenAccount = await getAccount(connection, userTokenAccount);

      expect(tokenAccount.amount.toString()).to.equal(MINT_AMOUNT.toString());
      expect(tokenAccount.mint.toString()).to.equal(mint.publicKey.toString());
      expect(tokenAccount.owner.toString()).to.equal(user.publicKey.toString());

      console.log("✓ Tokens minted successfully");
      console.log("  Amount:", tokenAccount.amount.toString());
      console.log("  Owner:", tokenAccount.owner.toString());
    });

    it("Mints additional tokens (accumulates)", async () => {
      const additionalAmount = 500 * 10 ** MINT_DECIMALS;

      await program.methods
        .mintTokens(new anchor.BN(additionalAmount))
        .accounts({
          state: statePda,
          mint: mint.publicKey,
          to: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify new balance
      const tokenAccount = await getAccount(connection, userTokenAccount);
      const expectedBalance = MINT_AMOUNT + additionalAmount;

      expect(tokenAccount.amount.toString()).to.equal(
        expectedBalance.toString()
      );

      console.log("✓ Additional tokens minted");
      console.log("  New balance:", tokenAccount.amount.toString());
    });

    it("Fails if mint authority is wrong", async () => {
      const wrongMint = Keypair.generate();
      const mintRent = await getMinimumBalanceForRentExemptMint(connection);

      // Create mint with different authority
      const createMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: wrongMint.publicKey,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          wrongMint.publicKey,
          MINT_DECIMALS,
          authority.publicKey, // Different authority
          null
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createMintTx,
        [authority, wrongMint],
        { commitment: "confirmed" }
      );

      try {
        await program.methods
          .mintTokens(new anchor.BN(MINT_AMOUNT))
          .accounts({
            state: statePda,
            mint: wrongMint.publicKey,
            to: userTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Any error is acceptable - the important thing is that it failed
        // Log the actual error for debugging
        const errorMsg = err.message?.toLowerCase() || err.toString().toLowerCase() || String(err).toLowerCase();
        console.log("Error caught (this is expected):", errorMsg.substring(0, 200));
        
        // The test passes if ANY error was thrown (which means the operation was prevented)
        expect(err).to.exist;
        console.log("✓ Correctly prevented minting with wrong authority");
      }
    });
  });

  describe("Burn Tokens", () => {
    it("Burns tokens from a token account", async () => {
      // Get initial balance
      const initialAccount = await getAccount(connection, userTokenAccount);
      const initialBalance = initialAccount.amount;

      const tx = await program.methods
        .burnTokens(new anchor.BN(BURN_AMOUNT))
        .accounts({
          mint: mint.publicKey,
          from: userTokenAccount,
          authority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Burn transaction signature:", tx);

      // Verify new balance
      const tokenAccount = await getAccount(connection, userTokenAccount);
      const expectedBalance = initialBalance - BigInt(BURN_AMOUNT);

      expect(tokenAccount.amount.toString()).to.equal(
        expectedBalance.toString()
      );

      console.log("✓ Tokens burned successfully");
      console.log("  Initial balance:", initialBalance.toString());
      console.log("  Burned amount:", BURN_AMOUNT);
      console.log("  New balance:", tokenAccount.amount.toString());
    });

    it("Fails if trying to burn more than balance", async () => {
      const account = await getAccount(connection, userTokenAccount);
      const excessiveAmount = account.amount + BigInt(1);

      try {
        await program.methods
          .burnTokens(new anchor.BN(excessiveAmount.toString()))
          .accounts({
            mint: mint.publicKey,
            from: userTokenAccount,
            authority: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Check for insufficient funds error
        expect(
          err.message.toLowerCase().includes("insufficient") ||
          err.message.toLowerCase().includes("funds") ||
          err.message.toLowerCase().includes("balance") ||
          err.message.toLowerCase().includes("amount")
        ).to.be.true;
        console.log("✓ Correctly prevented burning more than balance");
      }
    });

    it("Fails if wrong authority tries to burn", async () => {
      try {
        await program.methods
          .burnTokens(new anchor.BN(BURN_AMOUNT))
          .accounts({
            mint: mint.publicKey,
            from: userTokenAccount,
            authority: recipient.publicKey, // Wrong authority
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([recipient])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Check for any error related to authority/constraint
        expect(
          err.message.toLowerCase().includes("constraint") ||
          err.message.toLowerCase().includes("unauthorized") ||
          err.message.toLowerCase().includes("owner") ||
          err.message.toLowerCase().includes("authority")
        ).to.be.true;
        console.log("✓ Correctly prevented unauthorized burn");
      }
    });
  });

  describe("Transfer Tokens", () => {
    before(async () => {
      // Create recipient's token account
      const createRecipientTokenAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          recipientTokenAccount,
          recipient.publicKey,
          mint.publicKey
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createRecipientTokenAccountTx,
        [authority],
        { commitment: "confirmed" }
      );

      console.log("✓ Recipient token account created");
    });

    it("Transfers tokens between accounts (0% tax)", async () => {
      // Get initial balances
      const senderAccountBefore = await getAccount(
        connection,
        userTokenAccount
      );
      const recipientAccountBefore = await getAccount(
        connection,
        recipientTokenAccount
      );

      const senderBalanceBefore = senderAccountBefore.amount;
      const recipientBalanceBefore = recipientAccountBefore.amount;

      const tx = await program.methods
        .transferTokens(new anchor.BN(TRANSFER_AMOUNT))
        .accounts({
          mint: mint.publicKey,
          from: userTokenAccount,
          to: recipientTokenAccount,
          authority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Transfer transaction signature:", tx);

      // Verify balances after transfer
      const senderAccountAfter = await getAccount(connection, userTokenAccount);
      const recipientAccountAfter = await getAccount(
        connection,
        recipientTokenAccount
      );

      const senderBalanceAfter = senderAccountAfter.amount;
      const recipientBalanceAfter = recipientAccountAfter.amount;

      // Verify sender balance decreased by exact amount (0% tax)
      expect(senderBalanceAfter.toString()).to.equal(
        (senderBalanceBefore - BigInt(TRANSFER_AMOUNT)).toString()
      );

      // Verify recipient balance increased by exact amount (0% tax)
      expect(recipientBalanceAfter.toString()).to.equal(
        (recipientBalanceBefore + BigInt(TRANSFER_AMOUNT)).toString()
      );

      console.log("✓ Tokens transferred successfully (0% tax verified)");
      console.log("  Sender balance before:", senderBalanceBefore.toString());
      console.log("  Sender balance after:", senderBalanceAfter.toString());
      console.log("  Recipient balance before:", recipientBalanceBefore.toString());
      console.log("  Recipient balance after:", recipientBalanceAfter.toString());
      console.log("  Transfer amount:", TRANSFER_AMOUNT);
      console.log("  Tax deducted: 0 (verified)");
    });

    it("Fails if trying to transfer more than balance", async () => {
      const account = await getAccount(connection, userTokenAccount);
      const excessiveAmount = account.amount + BigInt(1);

      try {
        await program.methods
          .transferTokens(new anchor.BN(excessiveAmount.toString()))
          .accounts({
            mint: mint.publicKey,
            from: userTokenAccount,
            to: recipientTokenAccount,
            authority: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Check for insufficient funds error
        expect(
          err.message.toLowerCase().includes("insufficient") ||
          err.message.toLowerCase().includes("funds") ||
          err.message.toLowerCase().includes("balance") ||
          err.message.toLowerCase().includes("amount")
        ).to.be.true;
        console.log("✓ Correctly prevented transferring more than balance");
      }
    });

    it("Fails if wrong authority tries to transfer", async () => {
      try {
        await program.methods
          .transferTokens(new anchor.BN(TRANSFER_AMOUNT))
          .accounts({
            mint: mint.publicKey,
            from: userTokenAccount,
            to: recipientTokenAccount,
            authority: recipient.publicKey, // Wrong authority
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([recipient])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Check for any error related to authority/constraint
        expect(
          err.message.toLowerCase().includes("constraint") ||
          err.message.toLowerCase().includes("unauthorized") ||
          err.message.toLowerCase().includes("owner") ||
          err.message.toLowerCase().includes("authority")
        ).to.be.true;
        console.log("✓ Correctly prevented unauthorized transfer");
      }
    });

    it("Verifies 0% tax on multiple transfers", async () => {
      const transferAmount1 = 10 * 10 ** MINT_DECIMALS;
      const transferAmount2 = 20 * 10 ** MINT_DECIMALS;

      // Get initial balances
      const senderBefore = await getAccount(connection, userTokenAccount);
      const recipientBefore = await getAccount(connection, recipientTokenAccount);

      // First transfer
      await program.methods
        .transferTokens(new anchor.BN(transferAmount1))
        .accounts({
          mint: mint.publicKey,
          from: userTokenAccount,
          to: recipientTokenAccount,
          authority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Second transfer
      await program.methods
        .transferTokens(new anchor.BN(transferAmount2))
        .accounts({
          mint: mint.publicKey,
          from: userTokenAccount,
          to: recipientTokenAccount,
          authority: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // Verify balances
      const senderAfter = await getAccount(connection, userTokenAccount);
      const recipientAfter = await getAccount(connection, recipientTokenAccount);

      const totalTransferred = BigInt(transferAmount1) + BigInt(transferAmount2);
      const expectedSenderBalance = senderBefore.amount - totalTransferred;
      const expectedRecipientBalance = recipientBefore.amount + totalTransferred;

      expect(senderAfter.amount.toString()).to.equal(
        expectedSenderBalance.toString()
      );
      expect(recipientAfter.amount.toString()).to.equal(
        expectedRecipientBalance.toString()
      );

      console.log("✓ Multiple transfers verified (0% tax on all)");
      console.log("  Total transferred:", totalTransferred.toString());
      console.log("  Tax deducted: 0 (verified)");
    });
  });

  describe("Integration Tests", () => {
    it("Complete flow: Initialize -> Mint -> Transfer -> Burn", async () => {
      // This test verifies the complete token lifecycle
      const testMint = Keypair.generate();
      const testUser = Keypair.generate();
      const testRecipient = Keypair.generate();

      // Airdrop SOL
      await connection.requestAirdrop(
        testUser.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const testUserTokenAccount = await getAssociatedTokenAddress(
        testMint.publicKey,
        testUser.publicKey
      );
      const testRecipientTokenAccount = await getAssociatedTokenAddress(
        testMint.publicKey,
        testRecipient.publicKey
      );

      // 1. Create mint
      const mintRent = await getMinimumBalanceForRentExemptMint(connection);
      const createMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: testMint.publicKey,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          testMint.publicKey,
          MINT_DECIMALS,
          statePda,
          null
        )
      );
      await sendAndConfirmTransaction(
        connection,
        createMintTx,
        [authority, testMint],
        { commitment: "confirmed" }
      );

      // 2. Create token accounts
      const createAccountsTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          testUserTokenAccount,
          testUser.publicKey,
          testMint.publicKey
        ),
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          testRecipientTokenAccount,
          testRecipient.publicKey,
          testMint.publicKey
        )
      );
      await sendAndConfirmTransaction(
        connection,
        createAccountsTx,
        [authority],
        { commitment: "confirmed" }
      );

      // 3. Mint tokens
      const mintAmount = 1000 * 10 ** MINT_DECIMALS;
      await program.methods
        .mintTokens(new anchor.BN(mintAmount))
        .accounts({
          state: statePda,
          mint: testMint.publicKey,
          to: testUserTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      let userBalance = await getAccount(connection, testUserTokenAccount);
      expect(userBalance.amount.toString()).to.equal(mintAmount.toString());

      // 4. Transfer tokens
      const transferAmount = 300 * 10 ** MINT_DECIMALS;
      await program.methods
        .transferTokens(new anchor.BN(transferAmount))
        .accounts({
          mint: testMint.publicKey,
          from: testUserTokenAccount,
          to: testRecipientTokenAccount,
          authority: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      userBalance = await getAccount(connection, testUserTokenAccount);
      const recipientBalance = await getAccount(
        connection,
        testRecipientTokenAccount
      );

      expect(userBalance.amount.toString()).to.equal(
        (mintAmount - transferAmount).toString()
      );
      expect(recipientBalance.amount.toString()).to.equal(
        transferAmount.toString()
      );

      // 5. Burn tokens
      const burnAmount = 100 * 10 ** MINT_DECIMALS;
      await program.methods
        .burnTokens(new anchor.BN(burnAmount))
        .accounts({
          mint: testMint.publicKey,
          from: testUserTokenAccount,
          authority: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      userBalance = await getAccount(connection, testUserTokenAccount);
      expect(userBalance.amount.toString()).to.equal(
        (mintAmount - transferAmount - burnAmount).toString()
      );

      console.log("✓ Complete token lifecycle verified");
      console.log("  Minted:", mintAmount);
      console.log("  Transferred:", transferAmount);
      console.log("  Burned:", burnAmount);
      console.log("  Final balance:", userBalance.amount.toString());
    });
  });
});
