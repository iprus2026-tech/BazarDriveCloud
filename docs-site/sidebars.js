// @ts-check
// BD-DOCS-SITE-01 — sidebar for the docs-only shell. Item ids are the doc ids
// (directory path + frontmatter `id`).

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'index',
    {
      type: 'category',
      label: 'Project',
      items: ['project/overview'],
    },
    {
      type: 'category',
      label: 'Contracts',
      items: ['contracts/screen-contracts-overview'],
    },
    {
      type: 'category',
      label: 'Processes',
      items: ['processes/cloud-design-to-pr', 'processes/release-notes'],
    },
  ],
};

module.exports = sidebars;
