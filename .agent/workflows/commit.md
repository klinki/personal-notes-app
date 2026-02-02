---
description: How to commit changes with the required signature
---

When you are asked to commit changes, you MUST always include the `Co-authored-by` signature in the commit message to properly attribute the contribution.

Follow these steps:

1. Stage your changes:
   
   > [!IMPORTANT]
   > **Do not commit unrelated files.**
   > - Avoid committing build artifacts (e.g. `dist/`, `mnote.exe`), dependencies (`node_modules`), or temporary files.
   > - If you see these files in `git status`, add them to `.gitignore` before proceeding.
   > - Prefer staging specific files over `git add .` to ensure only intended changes are included.

   ```powershell
   git status
   git add <path/to/file>
   ```

2. Commit with the message and the footer. Ensure there is a blank line between the subject and the footer.
   **Guidelines:**
   - **Subject Line:** Max 50 characters. Capitalize the subject line. Do not end with a period.
   - **Body/Footer:** Max 72 characters per line. Wrap text if necessary.

   **Allowed Types:**
   - `feat`: A new feature
   - `fix`: A bug fix
   - `docs`: Documentation only changes
   - `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
   - `refactor`: A code change that neither fixes a bug nor adds a feature
   - `perf`: A code change that improves performance
   - `test`: Adding missing tests or correcting existing tests
   - `chore`: Changes to the build process or auxiliary tools and libraries such as documentation generation

   **Format:**
   ```powershell
   git commit -m "<type>: <description>" -m "

   Co-authored-by: Gemini 3 Pro (High) via Google Antigravity <gemini-bot@google.com>"
   ```

   **Example:**
   ```powershell
   git commit -m "feat: add amazing feature" -m "

   Co-authored-by: Gemini 3 Pro (High) via Google Antigravity <gemini-bot@google.com>"
   ```

// turbo
3. Verify the commit log:
   ```powershell
   git log -1
   ```
