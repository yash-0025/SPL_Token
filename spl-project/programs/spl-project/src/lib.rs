use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Gdcm1yXvSNjvLNWUdi7XfghXhatjrkWB8EHbtUpmPkUL");

#[program]
pub mod nc_token {
    use super::*;

    // Initialize NC Token with governance, bridge, treasury, bond addresses
    pub fn initialize(
        ctx: Context<Initialize>,
        governance: Pubkey,
        bridge: Pubkey,
        treasury: Pubkey,
        bond: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.governance = governance;
        state.bridge = bridge;
        state.treasury = treasury;
        state.bond = bond;
        state.emergency_paused = false;
        state.bump = ctx.bumps.state;
        
        // Set no sell limit for bridge and treasury (as per Ethereum contract)
        state.no_sell_limit.push(bridge);
        state.no_sell_limit.push(treasury);
        
        msg!("NC Token initialized with governance: {}", governance);
        Ok(())
    }

    // Governance functions (only callable by governance program via CPI)
    pub fn set_emergency_pause(ctx: Context<GovernanceOnly>, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.emergency_paused = value;
        emit!(EmergencyPauseSet { paused: value });
        msg!("Emergency pause set to: {}", value);
        Ok(())
    }

    pub fn set_blacklist(ctx: Context<GovernanceOnly>, account: Pubkey, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        if value {
            if !state.blacklisted.contains(&account) {
                state.blacklisted.push(account);
            }
        } else {
            state.blacklisted.retain(|&x| x != account);
        }
        emit!(BlacklistSet { account, value });
        msg!("Blacklist set for {}: {}", account, value);
        Ok(())
    }

    pub fn set_restricted(ctx: Context<GovernanceOnly>, account: Pubkey, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        if value {
            if !state.restricted_list.contains(&account) {
                state.restricted_list.push(account);
            }
        } else {
            state.restricted_list.retain(|&x| x != account);
        }
        emit!(RestrictedSet { account, value });
        msg!("Restricted set for {}: {}", account, value);
        Ok(())
    }

    pub fn set_no_sell_limit(ctx: Context<GovernanceOnly>, account: Pubkey, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        if value {
            if !state.no_sell_limit.contains(&account) {
                state.no_sell_limit.push(account);
            }
        } else {
            state.no_sell_limit.retain(|&x| x != account);
        }
        msg!("No sell limit set for {}: {}", account, value);
        Ok(())
    }

    pub fn set_liquidity_pool(ctx: Context<GovernanceOnly>, pool: Pubkey, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        if value {
            if !state.is_liquidity_pool.contains(&pool) {
                state.is_liquidity_pool.push(pool);
            }
        } else {
            state.is_liquidity_pool.retain(|&x| x != pool);
        }
        emit!(LiquidityPoolUpdated { pool, is_pool: value });
        msg!("Liquidity pool set for {}: {}", pool, value);
        Ok(())
    }

    // Transfer with all rules enforced (matches Ethereum _transfer logic)
    pub fn transfer(ctx: Context<TransferNC>, amount: u64) -> Result<()> {
        let state = &ctx.accounts.state;
        let from_key = ctx.accounts.from_authority.key();
        let to_key = ctx.accounts.to_account.key();
        
        // Check if from or to is restricted (Bridge, Bond, Treasury, etc.)
        let from_restricted = state.restricted_list.contains(&from_key);
        let to_restricted = state.restricted_list.contains(&to_key);
        
        // Emergency pause rules - only freezes protocol modules
        // P2P transfers remain allowed unless blacklist applies
        if state.emergency_paused {
            if from_restricted || to_restricted || 
               state.blacklisted.contains(&from_key) || 
               state.blacklisted.contains(&to_key) {
                return Err(ErrorCode::Paused.into());
            }
        }
        
        // Blacklist rules - can ONLY block interactions WITH protocol modules
        // Blacklisted users can still do normal P2P transfers
        // Both from & to blacklisted are not allowed
        if state.blacklisted.contains(&from_key) && to_restricted {
            return Err(ErrorCode::Blacklisted.into());
        }
        if state.blacklisted.contains(&to_key) && from_restricted {
            return Err(ErrorCode::Blacklisted.into());
        }
        if state.blacklisted.contains(&from_key) && state.blacklisted.contains(&to_key) {
            return Err(ErrorCode::Blacklisted.into());
        }
        
        // Max sell limit rule - enforce ONLY when:
        // - destination is LP
        // - sender is NOT exempt (Bridge / Treasury / Governance-approved)
        if state.is_liquidity_pool.contains(&to_key) &&
           !state.no_sell_limit.contains(&from_key) &&
           !from_restricted {
            enforce_sell_limit(&ctx, from_key, amount)?;
        }
        
        // Perform the transfer
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from_account.to_account_info(),
                    to: ctx.accounts.to_account.to_account_info(),
                    authority: ctx.accounts.from_authority.to_account_info(),
                },
            ),
            amount,
        )?;
        
        emit!(TransferEvent {
            from: from_key,
            to: to_key,
            amount,
        });
        
        msg!("Transfer completed: {} tokens from {} to {}", amount, from_key, to_key);
        Ok(())
    }

    // Helper function to enforce 5% sell limit per 24 hours (matches Ethereum _enforceSellLimit)
    fn enforce_sell_limit(
        ctx: &Context<TransferNC>,
        seller: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let from_account = &ctx.accounts.from_account;
        let sell_window = &mut ctx.accounts.sell_window;
        
        let current_balance = from_account.amount;
        let now_ts = Clock::get()?.unix_timestamp;
        
        // Start or reset rolling 24h window (true seconds-based)
        if sell_window.start_time == 0 || now_ts - sell_window.start_time >= 86400 {
            sell_window.start_time = now_ts;
            sell_window.start_balance = current_balance;
            // Clear old buckets
            sell_window.buckets = [SellBucket::default(); 24];
        }
        
        // Calculate 5% limit (500 basis points / 10000)
        let limit = sell_window.start_balance
            .checked_mul(500)
            .and_then(|x| x.checked_div(10000))
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Calculate total sold in last 24 hours
        let mut sold: u64 = 0;
        let hour_start = (now_ts / 3600) * 3600; // Round to hour start (seconds)
        
        for i in 0..24 {
            let bucket = &sell_window.buckets[i];
            if bucket.timestamp != 0 && now_ts - bucket.timestamp < 86400 {
                sold = sold.checked_add(bucket.amount).ok_or(ErrorCode::MathOverflow)?;
            }
        }
        
        // Check if this transfer would exceed limit
        let new_total = sold.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        require!(new_total <= limit, ErrorCode::SellLimitExceeded);
        
        // Update current hour bucket
        let hour_index = ((hour_start / 3600) % 24) as usize;
        if sell_window.buckets[hour_index].timestamp != hour_start {
            sell_window.buckets[hour_index] = SellBucket {
                timestamp: hour_start,
                amount: 0,
            };
        }
        sell_window.buckets[hour_index].amount = sell_window.buckets[hour_index]
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        Ok(())
    }

    // View functions
    pub fn is_blacklisted(ctx: Context<ViewOnly>, account: Pubkey) -> Result<bool> {
        let state = &ctx.accounts.state;
        Ok(state.blacklisted.contains(&account))
    }

    pub fn is_sell_limit(ctx: Context<ViewOnly>, account: Pubkey) -> Result<bool> {
        let state = &ctx.accounts.state;
        Ok(state.no_sell_limit.contains(&account))
    }

    pub fn is_restricted(ctx: Context<ViewOnly>, account: Pubkey) -> Result<bool> {
        let state = &ctx.accounts.state;
        Ok(state.restricted_list.contains(&account))
    }
}

// Account Structures

#[account]
pub struct NCTokenState {
    pub governance: Pubkey,
    pub bridge: Pubkey,
    pub treasury: Pubkey,
    pub bond: Pubkey,
    pub emergency_paused: bool,
    pub bump: u8,
    // Using Vec for storage (matches Ethereum mapping behavior)
    pub blacklisted: Vec<Pubkey>,        // Max 1000
    pub restricted_list: Vec<Pubkey>,    // Max 100
    pub no_sell_limit: Vec<Pubkey>,      // Max 100
    pub is_liquidity_pool: Vec<Pubkey>,  // Max 100
}

impl NCTokenState {
    pub const MAX_BLACKLIST: usize = 1000;
    pub const MAX_RESTRICTED: usize = 100;
    pub const MAX_NO_SELL_LIMIT: usize = 100;
    pub const MAX_LIQUIDITY_POOLS: usize = 100;
    
    pub const LEN: usize = 8 + // discriminator
        32 + // governance
        32 + // bridge
        32 + // treasury
        32 + // bond
        1 +  // emergency_paused
        1 +  // bump
        4 + (32 * Self::MAX_BLACKLIST) + // blacklisted vec
        4 + (32 * Self::MAX_RESTRICTED) + // restricted_list vec
        4 + (32 * Self::MAX_NO_SELL_LIMIT) + // no_sell_limit vec
        4 + (32 * Self::MAX_LIQUIDITY_POOLS); // is_liquidity_pool vec
}

#[account]
pub struct SellWindow {
    pub start_time: i64,
    pub start_balance: u64,
    pub buckets: [SellBucket; 24],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy)]
pub struct SellBucket {
    pub timestamp: i64,  // hour-start timestamp (seconds)
    pub amount: u64,     // sold in that hour bucket
}

impl SellWindow {
    pub const LEN: usize = 8 + // discriminator
        8 + // start_time
        8 + // start_balance
        (8 + 8) * 24 + // buckets (timestamp + amount) * 24
        1; // bump
}

// Context Structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + NCTokenState::LEN,
        seeds = [b"nc_token_state"],
        bump
    )]
    pub state: Account<'info, NCTokenState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GovernanceOnly<'info> {
    #[account(
        seeds = [b"nc_token_state"],
        bump = state.bump,
        constraint = state.governance == governance.key() @ ErrorCode::Unauthorized
    )]
    pub state: Account<'info, NCTokenState>,
    
    /// CHECK: Governance PDA (validated via constraint - must match state.governance)
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferNC<'info> {
    #[account(
        seeds = [b"nc_token_state"],
        bump = state.bump
    )]
    pub state: Account<'info, NCTokenState>,
    
    /// CHECK: Token mint
    pub mint: UncheckedAccount<'info>,
    
    /// CHECK: From token account
    #[account(mut)]
    pub from_account: Account<'info, TokenAccount>,
    
    /// CHECK: To token account
    #[account(mut)]
    pub to_account: Account<'info, TokenAccount>,
    
    /// CHECK: From authority (signer)
    pub from_authority: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = from_authority,
        space = 8 + SellWindow::LEN,
        seeds = [b"sell_window", from_authority.key().as_ref()],
        bump
    )]
    pub sell_window: Account<'info, SellWindow>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ViewOnly<'info> {
    #[account(
        seeds = [b"nc_token_state"],
        bump = state.bump
    )]
    pub state: Account<'info, NCTokenState>,
}

// Events (matches Ethereum events)
#[event]
pub struct EmergencyPauseSet {
    pub paused: bool,
}

#[event]
pub struct BlacklistSet {
    pub account: Pubkey,
    pub value: bool,
}

#[event]
pub struct RestrictedSet {
    pub account: Pubkey,
    pub value: bool,
}

#[event]
pub struct LiquidityPoolUpdated {
    pub pool: Pubkey,
    pub is_pool: bool,
}

#[event]
pub struct TransferEvent {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

// Error Codes
#[error_code]
pub enum ErrorCode {
    #[msg("Operation paused")]
    Paused,
    #[msg("Address is blacklisted")]
    Blacklisted,
    #[msg("Sell limit exceeded (5% per 24 hours)")]
    SellLimitExceeded,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized - only governance")]
    Unauthorized,
}
