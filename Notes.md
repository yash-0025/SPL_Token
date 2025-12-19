CPI - Cross program invocation
- Our program calls SPL token functions
- Eg: token::mint_to() calls the SPL Token Program
- Benefits :: reuse, security , no tax logic

PDA - Program Derived Address
- Deterministic address derived from seeds
- Example :["state"] seed creates a unique address
- Benefits: No keypair needed, program-controlled

Account Validation
#[account(...)] attributes validate accounts
init: Creates the account
mut: Account will be modified
seeds: For PDA derivation
bump: PDA bump seed

- SPL TOken is Solana's standard token program . It handles minting , burning and transfers
- CPI is battle tested code , compatible with wallets/DEXs , no need to reimplemnet token logic, it has no tax mechanisms

## What is anchor-spl?
=> Anchor wrapper for SPL Token , Provides helpers for CPI calls , Include types: Mint, TokenAccount , Token etc.

## Understanding the basix
- anchor_lang::prelude::* => Anchor basics
- anchor_spl::token => SPL Token helpers
- declare_id! => Program Id [from keypair]

- Account Structures 
=> 1. State accounts - store data ([#account])
=> 2. Context structs - define required accounts ([#derive(Accounts)])

### What is State Accunts?
- Stores program configuration , Persists data on chain , eg: who can mint tokens?
- Solana account have fixed size , we must specify when creating accounts, Rent is based on account size


- Changing  Account<'info, Mint> to UncheckedAccount<'info>
Q.] What Account<'info, Mint> does?
=>  Anchor tries to :: Deserialize the account data into a Mint struct, Validate the account (check it's the right type, owned by the right program), Generate IDL types so clients know what data structure to expect
- create_type() => to create the IDL type definition
- DISCRIMINATOR => to identify the account type
- insert_types() => to insert types into the IDL

-- Mint and TokenAccount from anchor_spl don't have these methods because:
- They're wrapped types around SPL Token accounts
- They're not Anchor account types (they don't have #[account] attribute)
- Anchor can't generate IDL for types it doesn't control

Q.] Why UncheckedAccount<'info> does?
=> Skips deserialization [you get raw account data], Skips validation [no type checking], Skips IDL generation (no type info needed). Just passes the account through
=> Why this is safe => Even though Anchor doesn't validate the accounts are still validated by the SPL Token Pogram when you call it via CPI : token::mint_to(CpiContext::new_with_signer(...), amount),)?;
- When this CPI call happends
1. SPL Token program receives the accounts
2. SPL Token validates the mint account is actually a mint
3. SPL Token vaidates the token account is actually a token account
4. SPL Token validates ownership, authority, etc.
So vaidation still happens - just by SPL Token not by Anchor.

When to use which one ? 
- Use Account when Type is our own account type , When we want anchor to validate and deserialize and we want IDL generation
- UncheckedAccount<'info> when account is from another program (like SPL Token), You're validating via CPI to that program, You don't need Anchor's validation/deserialization

```rust
// Our Own account - Anchor can handle this 
    pub state: Account<'info, TokenState> 

// SPL Token Account - Anchor can't generate IDL for these
    pub mint: UncheckedAccount<'info>
    pub to: UncheckedAccount<'info>
```

Account<'info, Mint> => Anchor tries to validate and generate IDL, but Mint doesn't support IDL generation -> error 
UncheckedAccount<'info> => Anchor skips validation IDL and SPL Token validates via CPI -> works
