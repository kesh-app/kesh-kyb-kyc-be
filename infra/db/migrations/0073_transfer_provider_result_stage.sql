-- Post-FinanceManager operational result stage.
--
-- Manager approval remains the transaction-date anchor, but no longer asserts
-- a bank/provider SUCCESS. FinanceStaff records the authoritative execution
-- result in the existing result/provider columns before the transfer becomes
-- terminal.

ALTER TYPE transfer_status
  ADD VALUE IF NOT EXISTS 'PENDING_FINANCE_STAFF_RESULT'
  AFTER 'PENDING_FINANCE_MANAGER_APPROVAL';
