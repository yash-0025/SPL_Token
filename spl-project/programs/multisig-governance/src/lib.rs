use anchor_lang::prelude::*;

declare_id!("MultiSigGov1111111111111111111111111111111");

#[program]
pub mod multisig_governance {
    use super::*;

    // Initialize governance
    pub fn initialize(ctx: Context<InitializeGovernance>) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        governance.cooldown_period = 90 * 60; // 90 minutes in seconds
        governance.required_approvals = 1;
        governance.token_set = false;
        governance.next_transaction_id = 1;
        governance.bump = ctx.bumps.governance;
        
        msg!("MultiSig Governance initialized");
        Ok(())
    }

    // Set required approvals (ADMIN only)
    pub fn set_required_approvals(
        ctx: Context<AdminOnly>,
        required: u8,
    ) -> Result<()> {
        require!(required > 0, ErrorCode::InvalidApprovalRequirement);
        let governance = &mut ctx.accounts.governance;
        let old_value = governance.required_approvals;
        governance.required_approvals = required;
        emit!(RequiredApprovalsChanged {
            old_value,
            new_value: required,
        });
        Ok(())
    }

    // Set token contract (ADMIN only, once)
    pub fn set_token(ctx: Context<AdminOnly>, token: Pubkey) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        require!(!governance.token_set, ErrorCode::TokenAlreadySet);
        require!(token != Pubkey::default(), ErrorCode::ZeroAddress);
        governance.nc_token = token;
        governance.token_set = true;
        emit!(TokenContractUpdated { new_token_contract: token });
        Ok(())
    }

    // Set cooldown period (ADMIN only)
    pub fn set_cooldown_period(
        ctx: Context<AdminOnly>,
        period: i64,
    ) -> Result<()> {
        require!(period > 0, ErrorCode::InvalidCooldownPeriod);
        let governance = &mut ctx.accounts.governance;
        governance.cooldown_period = period;
        Ok(())
    }

    // Emergency pause (ADMIN only, immediate - no queue)
    pub fn set_emergency_pause(ctx: Context<EmergencyPauseContext>) -> Result<()> {
        let governance = &ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        // Call NC Token via CPI - governance PDA signs
        let cpi_program = ctx.accounts.nc_token_program.to_account_info();
        let governance_seeds = &[
            b"governance",
            &[governance.bump],
        ];
        let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
            state: ctx.accounts.nc_token_state.to_account_info(),
            governance: ctx.accounts.governance.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            &[governance_seeds],
        );
        nc_token::cpi::set_emergency_pause(cpi_ctx, true)?;
        
        emit!(EmergencyPause {});
        Ok(())
    }

    // Queue transaction: Unpause
    pub fn set_unpause(ctx: Context<QueueTransaction>) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        
        let now = Clock::get()?.unix_timestamp;
        let execute_after = now + governance.cooldown_period;
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = tx_id;
        proposal.tx_type = TransactionType::Unpause;
        proposal.status = TransactionStatus::Pending;
        proposal.initiator = ctx.accounts.signer.key();
        proposal.target = Pubkey::default();
        proposal.amount = 0;
        proposal.data = Vec::new();
        proposal.timestamp = now;
        proposal.execute_after = execute_after;
        proposal.approval_count = 0;
        proposal.approvals = Vec::new();
        proposal.rejection_reason = String::new();
        proposal.rejector = Pubkey::default();
        proposal.exists = true;
        proposal.bump = ctx.bumps.proposal;
        
        emit!(TransactionQueued {
            tx_id,
            tx_type: TransactionType::Unpause,
            initiator: ctx.accounts.signer.key(),
        });
        Ok(())
    }

    // Queue transaction: Blacklist
    pub fn set_blacklist(
        ctx: Context<QueueTransaction>,
        account: Pubkey,
        value: bool,
    ) -> Result<()> {
        require!(account != Pubkey::default(), ErrorCode::ZeroAddress);
        let governance = &mut ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        let data = (account, value).try_to_vec()?;
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        
        let now = Clock::get()?.unix_timestamp;
        let execute_after = now + governance.cooldown_period;
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = tx_id;
        proposal.tx_type = TransactionType::Blacklist;
        proposal.status = TransactionStatus::Pending;
        proposal.initiator = ctx.accounts.signer.key();
        proposal.target = account;
        proposal.amount = 0;
        proposal.data = data;
        proposal.timestamp = now;
        proposal.execute_after = execute_after;
        proposal.approval_count = 0;
        proposal.approvals = Vec::new();
        proposal.rejection_reason = String::new();
        proposal.rejector = Pubkey::default();
        proposal.exists = true;
        proposal.bump = ctx.bumps.proposal;
        
        emit!(TransactionQueued {
            tx_id,
            tx_type: TransactionType::Blacklist,
            initiator: ctx.accounts.signer.key(),
        });
        Ok(())
    }

    // Queue transaction: No Sell Limit
    pub fn set_no_sell_limit(
        ctx: Context<QueueTransaction>,
        account: Pubkey,
        value: bool,
    ) -> Result<()> {
        require!(account != Pubkey::default(), ErrorCode::ZeroAddress);
        let governance = &mut ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        let data = (account, value).try_to_vec()?;
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        
        let now = Clock::get()?.unix_timestamp;
        let execute_after = now + governance.cooldown_period;
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = tx_id;
        proposal.tx_type = TransactionType::NoSellLimit;
        proposal.status = TransactionStatus::Pending;
        proposal.initiator = ctx.accounts.signer.key();
        proposal.target = account;
        proposal.amount = 0;
        proposal.data = data;
        proposal.timestamp = now;
        proposal.execute_after = execute_after;
        proposal.approval_count = 0;
        proposal.approvals = Vec::new();
        proposal.rejection_reason = String::new();
        proposal.rejector = Pubkey::default();
        proposal.exists = true;
        proposal.bump = ctx.bumps.proposal;
        
        emit!(TransactionQueued {
            tx_id,
            tx_type: TransactionType::NoSellLimit,
            initiator: ctx.accounts.signer.key(),
        });
        Ok(())
    }

    // Queue transaction: Restricted
    pub fn set_restricted(
        ctx: Context<QueueTransaction>,
        account: Pubkey,
        value: bool,
    ) -> Result<()> {
        require!(account != Pubkey::default(), ErrorCode::ZeroAddress);
        let governance = &mut ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        let data = (account, value).try_to_vec()?;
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        
        let now = Clock::get()?.unix_timestamp;
        let execute_after = now + governance.cooldown_period;
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = tx_id;
        proposal.tx_type = TransactionType::Restrict;
        proposal.status = TransactionStatus::Pending;
        proposal.initiator = ctx.accounts.signer.key();
        proposal.target = account;
        proposal.amount = 0;
        proposal.data = data;
        proposal.timestamp = now;
        proposal.execute_after = execute_after;
        proposal.approval_count = 0;
        proposal.approvals = Vec::new();
        proposal.rejection_reason = String::new();
        proposal.rejector = Pubkey::default();
        proposal.exists = true;
        proposal.bump = ctx.bumps.proposal;
        
        emit!(TransactionQueued {
            tx_id,
            tx_type: TransactionType::Restrict,
            initiator: ctx.accounts.signer.key(),
        });
        Ok(())
    }

    // Queue transaction: Liquidity Pool
    pub fn set_liquidity_pool(
        ctx: Context<QueueTransaction>,
        pool: Pubkey,
        value: bool,
    ) -> Result<()> {
        require!(pool != Pubkey::default(), ErrorCode::ZeroAddress);
        let governance = &mut ctx.accounts.governance;
        require!(governance.token_set, ErrorCode::TokenNotSet);
        
        let data = (pool, value).try_to_vec()?;
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        
        let now = Clock::get()?.unix_timestamp;
        let execute_after = now + governance.cooldown_period;
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = tx_id;
        proposal.tx_type = TransactionType::Pair;
        proposal.status = TransactionStatus::Pending;
        proposal.initiator = ctx.accounts.signer.key();
        proposal.target = pool;
        proposal.amount = 0;
        proposal.data = data;
        proposal.timestamp = now;
        proposal.execute_after = execute_after;
        proposal.approval_count = 0;
        proposal.approvals = Vec::new();
        proposal.rejection_reason = String::new();
        proposal.rejector = Pubkey::default();
        proposal.exists = true;
        proposal.bump = ctx.bumps.proposal;
        
        emit!(TransactionQueued {
            tx_id,
            tx_type: TransactionType::Pair,
            initiator: ctx.accounts.signer.key(),
        });
        Ok(())
    }

    // Approve transaction
    pub fn approve_transaction(
        ctx: Context<CanApprove>,
        tx_id: u64,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let governance = &ctx.accounts.governance;
        
        require!(proposal.id == tx_id, ErrorCode::TransactionIdMismatch);
        require!(proposal.exists, ErrorCode::TransactionNotFound);
        require!(
            proposal.status == TransactionStatus::Pending,
            ErrorCode::TransactionNotPending
        );
        require!(
            !proposal.approvals.contains(&ctx.accounts.approver.key()),
            ErrorCode::AlreadyApproved
        );
        
        proposal.approvals.push(ctx.accounts.approver.key());
        proposal.approval_count += 1;
        
        emit!(TransactionApproved {
            tx_id,
            approver: ctx.accounts.approver.key(),
        });
        
        // Auto-execute if enough approvals and cooldown expired
        let now = Clock::get()?.unix_timestamp;
        if proposal.approval_count >= governance.required_approvals &&
           now >= proposal.execute_after {
            execute_transaction(ctx, tx_id)?;
        }
        
        Ok(())
    }

    // Reject transaction
    pub fn reject_transaction(
        ctx: Context<CanApprove>,
        tx_id: u64,
        reason: String,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        
        require!(proposal.id == tx_id, ErrorCode::TransactionIdMismatch);
        require!(proposal.exists, ErrorCode::TransactionNotFound);
        require!(
            proposal.status == TransactionStatus::Pending,
            ErrorCode::TransactionNotPending
        );
        require!(reason.len() > 0, ErrorCode::RejectionReasonRequired);
        
        proposal.status = TransactionStatus::Rejected;
        proposal.rejection_reason = reason.clone();
        proposal.rejector = ctx.accounts.approver.key();
        
        emit!(TransactionRejected {
            tx_id,
            approver: ctx.accounts.approver.key(),
            reason,
        });
        
        Ok(())
    }

    // Execute transaction manually
    pub fn execute_transaction(
        ctx: Context<CanApprove>,
        tx_id: u64,
    ) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        let governance = &ctx.accounts.governance;
        
        require!(proposal.id == tx_id, ErrorCode::TransactionIdMismatch);
        require!(proposal.exists, ErrorCode::TransactionNotFound);
        require!(
            proposal.status == TransactionStatus::Pending,
            ErrorCode::TransactionNotPending
        );
        
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= proposal.execute_after,
            ErrorCode::CooldownNotExpired
        );
        require!(
            proposal.approval_count >= governance.required_approvals,
            ErrorCode::InsufficientApprovals
        );
        
        execute_transaction(ctx, tx_id)?;
        Ok(())
    }

    // Helper: Queue transaction (creates proposal PDA)
    fn queue_transaction(
        governance: &mut Account<Governance>,
        tx_type: TransactionType,
        target: Pubkey,
        amount: u64,
        data: Vec<u8>,
    ) -> Result<u64> {
        let tx_id = governance.next_transaction_id;
        governance.next_transaction_id += 1;
        Ok(tx_id)
    }

    // Helper: Execute transaction
    fn execute_transaction(ctx: Context<CanApprove>, tx_id: u64) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        let governance = &ctx.accounts.governance;
        
        // Call NC Token based on transaction type
        let cpi_program = ctx.accounts.nc_token_program.to_account_info();
        
        // Governance PDA signs for CPI
        let governance_seeds = &[
            b"governance",
            &[governance.bump],
        ];
        
        match proposal.tx_type {
            TransactionType::Unpause => {
                let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
                    state: ctx.accounts.nc_token_state.to_account_info(),
                    governance: governance.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    cpi_program,
                    cpi_accounts,
                    &[governance_seeds],
                );
                nc_token::cpi::set_emergency_pause(cpi_ctx, false)?;
                emit!(EmergencyUnpause {});
            }
            TransactionType::Blacklist => {
                let (account, value): (Pubkey, bool) = 
                    try_from_slice(&proposal.data)?;
                let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
                    state: ctx.accounts.nc_token_state.to_account_info(),
                    governance: governance.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    cpi_program,
                    cpi_accounts,
                    &[governance_seeds],
                );
                nc_token::cpi::set_blacklist(cpi_ctx, account, value)?;
                emit!(AddressBlacklisted { account, status: value });
            }
            TransactionType::NoSellLimit => {
                let (account, value): (Pubkey, bool) = 
                    try_from_slice(&proposal.data)?;
                let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
                    state: ctx.accounts.nc_token_state.to_account_info(),
                    governance: governance.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    cpi_program,
                    cpi_accounts,
                    &[governance_seeds],
                );
                nc_token::cpi::set_no_sell_limit(cpi_ctx, account, value)?;
                emit!(NoSellLimitSet { account, status: value });
            }
            TransactionType::Restrict => {
                let (account, value): (Pubkey, bool) = 
                    try_from_slice(&proposal.data)?;
                let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
                    state: ctx.accounts.nc_token_state.to_account_info(),
                    governance: governance.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    cpi_program,
                    cpi_accounts,
                    &[governance_seeds],
                );
                nc_token::cpi::set_restricted(cpi_ctx, account, value)?;
                emit!(AddressRestricted { account, status: value });
            }
            TransactionType::Pair => {
                let (pool, value): (Pubkey, bool) = 
                    try_from_slice(&proposal.data)?;
                let cpi_accounts = nc_token::cpi::accounts::GovernanceOnly {
                    state: ctx.accounts.nc_token_state.to_account_info(),
                    governance: governance.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    cpi_program,
                    cpi_accounts,
                    &[governance_seeds],
                );
                nc_token::cpi::set_liquidity_pool(cpi_ctx, pool, value)?;
                emit!(PairSet { account: pool, status: value });
            }
            _ => return Err(ErrorCode::InvalidTransactionType.into()),
        }
        
        let proposal = &mut ctx.accounts.proposal;
        proposal.status = TransactionStatus::Executed;
        
        emit!(TransactionExecuted { tx_id, auto_executed: false });
        Ok(())
    }
}

// Account Structures

#[account]
pub struct Governance {
    pub cooldown_period: i64,
    pub required_approvals: u8,
    pub nc_token: Pubkey,
    pub token_set: bool,
    pub next_transaction_id: u64,
    pub bump: u8,
}

impl Governance {
    pub const LEN: usize = 8 + // discriminator
        8 + // cooldown_period
        1 + // required_approvals
        32 + // nc_token
        1 + // token_set
        8 + // next_transaction_id
        1; // bump
}

#[account]
pub struct PendingTransaction {
    pub id: u64,
    pub tx_type: TransactionType,
    pub status: TransactionStatus,
    pub initiator: Pubkey,
    pub target: Pubkey,
    pub amount: u64,
    pub data: Vec<u8>,
    pub timestamp: i64,
    pub execute_after: i64,
    pub approval_count: u8,
    pub approvals: Vec<Pubkey>,
    pub rejection_reason: String,
    pub rejector: Pubkey,
    pub exists: bool,
    pub bump: u8,
}

impl PendingTransaction {
    pub const MAX_DATA: usize = 256;
    pub const MAX_REASON: usize = 256;
    pub const MAX_APPROVALS: usize = 10;
    
    pub const LEN: usize = 8 + // discriminator
        8 + // id
        1 + // tx_type
        1 + // status
        32 + // initiator
        32 + // target
        8 + // amount
        4 + Self::MAX_DATA + // data
        8 + // timestamp
        8 + // execute_after
        1 + // approval_count
        4 + (32 * Self::MAX_APPROVALS) + // approvals
        4 + Self::MAX_REASON + // rejection_reason
        32 + // rejector
        1 + // exists
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum TransactionType {
    Unpause,
    Blacklist,
    NoSellLimit,
    Restrict,
    Pair,
    RoleGrant,
    RoleRevoke,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum TransactionStatus {
    Pending,
    Rejected,
    Executed,
    AutoExecuted,
}

// Context Structures

#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Governance::LEN,
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, Governance>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SignerOnly<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct QueueTransaction<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    #[account(
        init,
        payer = signer,
        space = 8 + PendingTransaction::LEN,
        seeds = [b"proposal", governance.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, PendingTransaction>,
    
    pub signer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(tx_id: u64)]
pub struct CanApprove<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    #[account(
        mut,
        seeds = [b"proposal", tx_id.to_le_bytes().as_ref()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, PendingTransaction>,
    
    /// CHECK: NC Token program
    pub nc_token_program: UncheckedAccount<'info>,
    
    /// CHECK: NC Token state
    pub nc_token_state: UncheckedAccount<'info>,
    
    pub approver: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyPauseContext<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    /// CHECK: NC Token program
    pub nc_token_program: UncheckedAccount<'info>,
    
    /// CHECK: NC Token state
    pub nc_token_state: UncheckedAccount<'info>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

// Events
#[event]
pub struct TransactionQueued {
    pub tx_id: u64,
    pub tx_type: TransactionType,
    pub initiator: Pubkey,
}

#[event]
pub struct TransactionApproved {
    pub tx_id: u64,
    pub approver: Pubkey,
}

#[event]
pub struct TransactionRejected {
    pub tx_id: u64,
    pub approver: Pubkey,
    pub reason: String,
}

#[event]
pub struct TransactionExecuted {
    pub tx_id: u64,
    pub auto_executed: bool,
}

#[event]
pub struct AddressBlacklisted {
    pub account: Pubkey,
    pub status: bool,
}

#[event]
pub struct TokenContractUpdated {
    pub new_token_contract: Pubkey,
}

#[event]
pub struct RequiredApprovalsChanged {
    pub old_value: u8,
    pub new_value: u8,
}

#[event]
pub struct NoSellLimitSet {
    pub account: Pubkey,
    pub status: bool,
}

#[event]
pub struct AddressRestricted {
    pub account: Pubkey,
    pub status: bool,
}

#[event]
pub struct PairSet {
    pub account: Pubkey,
    pub status: bool,
}

#[event]
pub struct EmergencyPause {}

#[event]
pub struct EmergencyUnpause {}

// Error Codes
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid approval requirement")]
    InvalidApprovalRequirement,
    #[msg("Token already set")]
    TokenAlreadySet,
    #[msg("Token not set")]
    TokenNotSet,
    #[msg("Invalid cooldown period")]
    InvalidCooldownPeriod,
    #[msg("Zero address")]
    ZeroAddress,
    #[msg("Transaction not found")]
    TransactionNotFound,
    #[msg("Transaction not pending")]
    TransactionNotPending,
    #[msg("Already approved")]
    AlreadyApproved,
    #[msg("Rejection reason required")]
    RejectionReasonRequired,
    #[msg("Cooldown not expired")]
    CooldownNotExpired,
    #[msg("Insufficient approvals")]
    InsufficientApprovals,
    #[msg("Invalid transaction type")]
    InvalidTransactionType,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Transaction ID mismatch")]
    TransactionIdMismatch,
}

