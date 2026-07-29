/**
 * FontCatalogShell — prefer CatalogIsland for the home route (QueryProvider scoped).
 * Re-exports the client island for older imports.
 */
export {
  CatalogIsland as FontCatalogShell,
  CatalogIsland as CatalogShell,
} from "@/components/catalog/catalog-island";
