use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Token, Burn, Transfer, SetAuthority};
use anchor_spl::token::spl_token::instruction::AuthorityType;

declare_id!("Gdcm1yXvSNjvLNWUdi7XfghXhatjrkWB8EHbtUpmPkUL");

#[program]
pub mod spl_project {
    use super::*;

    // Initialize
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.bump = ctx.bumps.state;

        msg!("Token program initialized by: {:?}", state.authority);
        Ok(())
    }

    // Mint Token

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        msg!("Minting {} tokens", amount);

        // Create PDA signer
        let bump = ctx.accounts.state.bump;
        let state_seed = b"state";
        let bump_seed = [bump];
        let seeds = &[
            state_seed.as_ref(),
            &bump_seed[..],
        ];
        let signer = &[&seeds[..]];

        // Call SPL Token's mint_to via CPI
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        msg!("Successfully minted {} tokens", amount );
        Ok(())
    }
    // Burn Token
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        msg!("Burning {} tokens", amount);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.from.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Successfully burned {} tokens", amount);
        Ok(())
    }


    // Transfer Token

    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        msg!("Transferring {} tokens", amount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Successfully transferred {} tokens", amount);
        Ok(())
    }

    pub fn revoke_mint_authority(ctx: Context<RevokeMintAuthority>) -> Result<()> {
        msg!("Revoking mint authority for : {:?}", ctx.accounts.mint.key());

        // Create PDA signer
        let bump = ctx.accounts.state.bump;
        let state_seed = b"state";
        let bump_seed = [bump];
        let seeds = &[state_seed.as_ref(), &bump_seed[..],];
        let signer = &[&seeds[..]];

        // Call SPL Tokens set authority via CPI
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.state.to_account_info(),
                },
                signer,
            ),
            AuthorityType::MintTokens,
            None,
        )?;
        msg!("Mint authority successfully revoked!");
        Ok(())
    }
}


// Context Structures

// Initialize
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TokenState::LEN,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, TokenState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// MintTokens
#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub to: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// BurnTokens
#[derive(Accounts)]
pub struct BurnTokens<'info>{
    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub from: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// TransferTokens
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    /// CHECK: SPL Token mint account (validated by token program)
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub from: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub to: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}


#[derive(Accounts)]
pub struct RevokeMintAuthority<'info> {
    #[account(
        seeds=[b"state"],
        bump=state.bump,
    )]
    pub state: Account<'info, TokenState>,
    
    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}


// Account structures

#[account]
pub struct TokenState {
    pub authority: Pubkey,
    pub bump: u8,
}

impl TokenState {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 u8]
}
