import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/index.css',
        './src/layouts/DirectorySelectionLayout.tsx',
        './src/hooks/useFileSystem.ts',
        './src/lib/fileSystem.ts',
        './src/ui/Button.tsx',
        './src/features/workspace/components/WorkspaceShell.tsx',
        './src/layouts/ExplorerWorkspaceLayout.tsx',
        './src/features/explorer/components/FileBrowserGrid.tsx',
        './src/features/explorer/components/FileGridViewport.tsx',
        './src/features/explorer/components/ExplorerToolbar.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
