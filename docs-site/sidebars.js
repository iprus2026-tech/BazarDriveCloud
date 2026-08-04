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
      items: ['processes/BD-DOCS-004', 'processes/BD-DOCS-005', 'processes/BD-DOCS-006', 'processes/BD-DOCS-040', 'processes/BD-DOCS-042', 'processes/BD-DOCS-043'],
    },
    {
      type: 'category',
      label: 'Decisions',
      items: ['decisions/BD-DOCS-030', 'decisions/BD-DOCS-032', 'decisions/BD-DOCS-033', 'decisions/BD-DOCS-034', 'decisions/BD-DOCS-035', 'decisions/BD-DOCS-036', 'decisions/BD-DOCS-037', 'decisions/BD-DOCS-038', 'decisions/BD-DOCS-041', 'decisions/BD-DOCS-044'],
    },
    {
      type: 'category',
      label: 'Design',
      items: ['design/BD-DOCS-031'],
    },
    {
      type: 'category',
      label: 'Audits',
      items: ['audits/BD-DOCS-039', 'audits/BD-DOCS-045'],
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
