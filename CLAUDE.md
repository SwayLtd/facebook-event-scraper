# Project Instructions

## Mode Autonome

**REGLE D'OR** : Implemente directement sans demander confirmation, sauf ambiguite reelle.

- **N'UTILISE JAMAIS** : "Voulez-vous...", "Dois-je...", "Puis-je...", "Avez-vous besoin...", questions demandant validation
- **UTILISE AU LIEU** : "Je vais...", "Voici ce que j'ai change...", "J'implemente..."
- Applique les changements immediatement — explication apres, pas avant
- **Seules exceptions** : ambiguite reelle sur l'intention, ou risque critique (suppression/perte de donnees)

## Deep Thinking & Research

Pour toute question technique ou implementation non triviale :

1. **Reflexion structuree** : Decompose le probleme etape par etape avant de coder
2. **Recherche de documentation** : Pour toute librairie, framework ou package :
   - Utilise Context7 MCP pour consulter la documentation a jour (resolve-library-id puis query-docs)
3. **Recherche Internet** : Si la documentation Context7 ne suffit pas :
   - Utilise Brave Search MCP pour rechercher sur le web
   - Utilise Fetch MCP pour lire le contenu des pages trouvees
   - **Ne lance JAMAIS plusieurs appels brave_web_search en parallele** (rate limit)
4. **N'utilise JAMAIS fetch sur des fichiers locaux** (file://). Uniquement des URLs web (http/https)

## Workflow

**UTILISE SYSTEMATIQUEMENT** :
- Les subagents (Task tool) pour les taches longues ou paralleles
- Lancer les tests apres modifications de code

## ES Modules Only

- Always use ES Modules (`import`/`export`). Never use CommonJS (`require`, `module.exports`).
- Convert any CommonJS code to ES Modules on sight.

## Code Organization

### Import Order
1. Built-in Node.js modules (`node:fs`, `node:path`, `process`)
2. Third-party packages (`luxon`, `axios`, `@supabase/supabase-js`)
3. Local utilities (`./utils/...`)
4. Local models (`./models/...`)
5. Local components (`./...`)

### Project Structure
- **`utils/`** — Reusable utilities: `logger.js`, `token.js`, `date.js`, `name.js`, `social.js`, `geo.js`, `delay.js`
- **`models/`** — Business logic: `artist.js`, `event.js`, `genre.js`, `promoter.js`, `venue.js`

## Code Standards

- Use existing utility and model functions when available
- Follow established naming conventions and patterns
- ES2022+ features, compatible with both Node.js and Bun
- Use `node:` prefix for built-in modules
- Prefer named exports for utilities, default exports for main classes
- Proper async/await usage throughout

## Error Handling

- Validate inputs and handle edge cases
- Use try-catch for async operations
- Log errors using the `logger` utility (`utils/logger.js`)
- Always check for null/undefined values
