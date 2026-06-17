// @ts-check
// BD-DOCS-SITE-01 — Docusaurus docs-only shell for BazarDriveCloud.
//
// This is a standalone docs-as-code layer. It is intentionally decoupled from
// the runtime PWA (public/) — it has its own package.json, its own build, and
// its own CI workflow (.github/workflows/docs-site-ci.yml). It does NOT deploy
// over the existing GitHub Pages PWA and does NOT import anything from public/.

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'BazarDrive Docs',
  tagline: 'Docs-as-code for BazarDriveCloud — separate from the runtime PWA',
  url: 'https://iprus2026-tech.github.io',
  // Placeholder base path — this shell is not wired to a deployment yet.
  baseUrl: '/bazardrive-docs/',
  organizationName: 'iprus2026-tech',
  projectName: 'BazarDriveCloud',

  // Partial docs today — keep link checks non-fatal so the shell builds while
  // the documentation is migrated incrementally.
  onBrokenLinks: 'warn',

  // onBrokenMarkdownLinks moved under markdown.hooks in Docusaurus 3.6+.
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'ru',
    locales: ['ru'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // Docs-only mode: docs are served at the site root.
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          // "Edit this page" points at the doc source in the repo — reinforces
          // that the repository is the source of truth (see project/overview).
          editUrl:
            'https://github.com/iprus2026-tech/BazarDriveCloud/tree/main/docs-site/',
        },
        blog: false,
        theme: {},
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'BazarDrive Docs',
        items: [
          { type: 'docSidebar', sidebarId: 'docsSidebar', position: 'left', label: 'Docs' },
          {
            href: 'https://github.com/iprus2026-tech/BazarDriveCloud',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        copyright: 'BazarDriveCloud · docs-as-code shell (BD-DOCS-SITE-01).',
      },
    }),
};

module.exports = config;
