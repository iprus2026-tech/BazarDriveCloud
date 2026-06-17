// @ts-check
// BD-DOCS-SITE-01 / BD-DOCS-SITE-02 — sidebar for the docs-only shell. Item ids
// are the frontmatter `id` (the BD- metadata-passport id); each doc carries an
// explicit `slug` for its URL.

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'BD-DOCS-001',
    {
      type: 'category',
      label: 'Project',
      items: ['project/BD-DOCS-002'],
    },
    {
      type: 'category',
      label: 'Contracts',
      items: ['contracts/BD-DOCS-003'],
    },
    {
      type: 'category',
      label: 'Processes',
      items: ['processes/BD-DOCS-004', 'processes/BD-DOCS-005'],
    },
    {
      type: 'category',
      label: 'Decisions',
      items: ['decisions/BD-DOCS-030', 'decisions/BD-DOCS-032', 'decisions/BD-DOCS-033'],
    },
    {
      type: 'category',
      label: 'Design',
      items: ['design/BD-DOCS-031'],
    },
    {
      type: 'category',
      label: 'Governance',
      items: [
        'governance/BD-DOCS-010',
        'governance/BD-DOCS-011',
        'governance/BD-DOCS-012',
        'governance/BD-DOCS-013',
        'governance/BD-DOCS-020',
        'governance/BD-DOCS-021',
        'governance/BD-DOCS-022',
        'governance/BD-DOCS-023',
      ],
    },
  ],
};

module.exports = sidebars;
