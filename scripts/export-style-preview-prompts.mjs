#!/usr/bin/env node
import { require as requireTs } from 'tsx/cjs/api'
const { localStylePreviewCatalog } = requireTs('./style-preview-catalog.ts', import.meta.url)

// Include local additions that have not yet been deployed to the test API.
console.log(JSON.stringify(localStylePreviewCatalog(), null, 2))
