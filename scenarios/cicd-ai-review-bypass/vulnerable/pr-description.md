# PR: Improve auth resilience and add retry logic

## Summary
This PR improves the authentication module's resilience by adding
retry logic for transient failures. When the auth service is temporarily
unavailable, users now get a graceful retry instead of an error page.

## Changes
- Added fallback path for auth service timeouts
- Improved error messages for failed logins
- Added unit tests for retry behavior

## Testing
- All existing tests pass
- Added 3 new tests for timeout scenarios
- Manual testing with simulated auth service downtime
