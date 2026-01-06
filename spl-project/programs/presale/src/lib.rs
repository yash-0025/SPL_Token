use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("");

#[program]
pub mod presale {
    use super::*;

    // Initialize the presale contract
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        presale_token_mint: Pubkey,
    ) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.admin = admin;
        presale_state.presale_token_mint = presale_token_mint;
        presale_state.status = PresaleStatus::NotStarted;
        presale_state.total_tokens_sold = 0;
        presale_state.total_raised = 0;
        
        Ok(())
    }

    // Admin function to start the presale
    pub fn start_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        require!(
            presale_state.status == PresaleStatus::NotStarted 
                || presale_state.status == PresaleStatus::Paused,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Active;
        msg!("Presale started");
        Ok(())
    }

    // Admin function to stop the presale
    pub fn stop_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Stopped;
        msg!("Presale stopped");
        Ok(())
    }

    // Admin function to pause the presale
    pub fn pause_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Paused;
        msg!("Presale paused");
        Ok(())
    }

    // Admin function to allow a payment token (USDC, USDT, etc.)
    pub fn allow_payment_token(
        ctx: Context<AllowPaymentToken>,
        payment_token_mint: Pubkey,
    ) -> Result<()> {
        let allowed_token = &mut ctx.accounts.allowed_token;
        allowed_token.payment_token_mint = payment_token_mint;
        allowed_token.is_allowed = true;
        allowed_token.presale_state = ctx.accounts.presale_state.key();
        
        msg!("Payment token allowed: {}", payment_token_mint);
        Ok(())
    }

    // Admin function to disallow a payment token
    pub fn disallow_payment_token(
        ctx: Context<DisallowPaymentToken>,
    ) -> Result<()> {
        let allowed_token = &mut ctx.accounts.allowed_token;
        allowed_token.is_allowed = false;
        
        msg!("Payment token disallowed");
        Ok(())
    }

    // Buy function - users can buy presale tokens with allowed payment tokens
    pub fn buy(
        ctx: Context<Buy>,
        amount: u64, // Amount of payment tokens to spend
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        // Check if presale is active
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::PresaleNotActive
        );

        // Check if payment token is allowed
        let allowed_token = &ctx.accounts.allowed_token;
        require!(
            allowed_token.is_allowed,
            PresaleError::PaymentTokenNotAllowed
        );

        // Calculate tokens to receive (1:1 ratio - you can modify this)
        let tokens_to_receive = amount; // Adjust based on your pricing logic

        // Transfer payment tokens from buyer to presale vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_payment_token_account.to_account_info(),
            to: ctx.accounts.presale_payment_vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Transfer presale tokens from presale vault to buyer
        let seeds = &[
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref(),
            &[ctx.bumps.presale_token_vault_pda],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.presale_token_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.presale_token_vault_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, tokens_to_receive)?;

        // Update state
        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.total_tokens_sold = presale_state
            .total_tokens_sold
            .checked_add(tokens_to_receive)
            .ok_or(PresaleError::Overflow)?;
        presale_state.total_raised = presale_state
            .total_raised
            .checked_add(amount)
            .ok_or(PresaleError::Overflow)?;

        msg!(
            "Buy successful: {} tokens for {} payment tokens",
            tokens_to_receive,
            amount
        );

        Ok(())
    }
}

// Account Structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + PresaleState::LEN,
        seeds = [b"presale_state"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.admin == admin.key() @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AllowPaymentToken<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.admin == admin.key() @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + AllowedToken::LEN,
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    pub admin: Signer<'info>,
    
    pub payment_token_mint: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisallowPaymentToken<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.admin == admin.key() @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        mut,
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    pub admin: Signer<'info>,
    
    pub payment_token_mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    #[account(
        mut,
        constraint = buyer_payment_token_account.mint == payment_token_mint.key()
    )]
    pub buyer_payment_token_account: Account<'info, TokenAccount>,
    
    // PDA that will own the payment token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_payment_vault_pda",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub presale_payment_vault_pda: UncheckedAccount<'info>,
    
    // ATA owned by the payment vault PDA
    #[account(
        mut,
        associated_token::mint = payment_token_mint,
        associated_token::authority = presale_payment_vault_pda
    )]
    pub presale_payment_vault: Account<'info, TokenAccount>,
    
    // PDA that will own the presale token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref()
        ],
        bump
    )]
    pub presale_token_vault_pda: UncheckedAccount<'info>,
    
    // ATA owned by the presale token vault PDA
    #[account(
        mut,
        associated_token::mint = presale_state.presale_token_mint,
        associated_token::authority = presale_token_vault_pda
    )]
    pub presale_token_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = buyer_token_account.mint == presale_state.presale_token_mint
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    pub payment_token_mint: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// State Structures

#[account]
pub struct PresaleState {
    pub admin: Pubkey,
    pub presale_token_mint: Pubkey,
    pub status: PresaleStatus,
    pub total_tokens_sold: u64,
    pub total_raised: u64,
}

impl PresaleState {
    pub const LEN: usize = 32 + 32 + 1 + 8 + 8; // admin + mint + status + sold + raised
}

#[account]
pub struct AllowedToken {
    pub presale_state: Pubkey,
    pub payment_token_mint: Pubkey,
    pub is_allowed: bool,
}

impl AllowedToken {
    pub const LEN: usize = 32 + 32 + 1; // presale_state + mint + is_allowed
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PresaleStatus {
    NotStarted,
    Active,
    Paused,
    Stopped,
}

// Error Codes

#[error_code]
pub enum PresaleError {
    #[msg("Unauthorized: Only admin can perform this action")]
    Unauthorized,
    #[msg("Presale is not active")]
    PresaleNotActive,
    #[msg("Payment token is not allowed")]
    PaymentTokenNotAllowed,
    #[msg("Invalid presale status for this operation")]
    InvalidStatus,
    #[msg("Arithmetic overflow")]
    Overflow,
}