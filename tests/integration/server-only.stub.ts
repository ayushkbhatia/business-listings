/**
 * `server-only` throws on import unless the bundler resolves its `react-server`
 * export condition, which Vitest does not. The package is a build-time fence,
 * not a runtime behaviour, so aliasing it away in the integration project loses
 * nothing: these tests run in node and are the server.
 *
 * Only the integration project uses this alias. The jsdom project does not, so
 * a client component that imports a server module still fails there, which is
 * the mistake the fence exists to catch.
 */
export {};
