#!/usr/bin/env node
import { require as requireTs } from 'tsx/cjs/api'
const { localStylePreviewCatalog } = requireTs('./style-preview-catalog.ts', import.meta.url)

// Export the local preset catalog without calling a business API.
console.log(JSON.stringify(localStylePreviewCatalog(), null, 2))
