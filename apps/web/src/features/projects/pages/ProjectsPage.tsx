/**
 * Route-facing Project feature boundary.
 *
 * The discovery implementation lives in the v0.6 module while the compatibility
 * exports in ControlPages are retired incrementally. Keeping this boundary small
 * lets the router stop depending on the legacy page module.
 */
export { ProjectsDiscoveryPage as ProjectsPage } from '../../../pages/v06/DiscoveryPages';
