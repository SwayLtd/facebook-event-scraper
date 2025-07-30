# Copilot Instructions

## ES Modules Requirements

IMPORTANT: Always use ES Modules (import/export) for all imports and exports in this project.

- **Never use CommonJS** (`require`, `module.exports`).
- **Always use the modern syntax:**
  ```js
  import module from 'module';
  import { namedExport } from 'module';
  export default ...;
  export { namedExport };
  ```
- **If you see any CommonJS code, convert it to ES Modules.**
- **This rule applies to all scripts, utilities, and files in the project.**

## Code Organization & Structure

### Import Organization
- **Always place all imports at the beginning of the file**
- **Group imports in this order:**
  1. Built-in Node.js modules (e.g., `fs`, `path`, `process`)
  2. Third-party packages (e.g., `luxon`, `axios`, `@supabase/supabase-js`)
  3. Local utility imports (`./utils/...`)
  4. Local model imports (`./models/...`)
  5. Local component imports (`./...`)

### Project Structure
This project follows a modular architecture:

- **`utils/`** - Reusable utility functions and modules:
  - `logger.js` - Logging functionality
  - `token.js` - Authentication token management
  - `date.js` - Date/time utilities
  - `name.js` - Name normalization functions
  - `social.js` - Social media link handling
  - `geo.js` - Geocoding utilities
  - `delay.js` - Async delay utilities

- **`models/`** - Business logic and data models:
  - `artist.js` - Artist-related operations
  - `event.js` - Event management
  - `genre.js` - Genre classification
  - `promoter.js` - Promoter data handling
  - `venue.js` - Venue management

### Code Quality Standards

- **ESLint Compliance**: All code must follow ESLint rules and pass linting
- **Error Handling**: Always implement proper error handling and validation
- **Type Safety**: Use JSDoc comments for type hints when beneficial

## Implementation Guidelines

### Development Process
1. **Always place imports at the beginning of files**
2. **Use the established utility and model functions when available**
3. **Follow the existing code patterns and naming conventions**
4. **Implement proper error handling and logging**
5. **Test your changes thoroughly**
6. **Always fix any errors at the end of implementation**

### Module Best Practices
- Use explicit import/export statements
- Prefer named exports for utilities and functions
- Use default exports for main classes or primary functionality
- Include proper JSDoc documentation for exported functions
- Handle both success and error cases appropriately

### Node.js/Bun Compatibility
- Code should work with both Node.js and Bun runtimes
- Use modern JavaScript features (ES2022+)
- Leverage built-in modules when possible (`node:fs`, `node:path`, etc.)
- Ensure proper async/await usage

## Error Prevention
- **Validate inputs and handle edge cases**
- **Use try-catch blocks for async operations**
- **Log meaningful error messages using the logger utility**
- **Test with both valid and invalid data**
- **Always check for null/undefined values**

Please follow these conventions to ensure code consistency, maintainability, and modern standards.
