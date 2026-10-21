module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'jvm-is-browser-independent',
      severity: 'error',
      from: { path: '^src/jvm/' },
      to: {
        path:
          '^src/ui/|(^|/)node_modules/(react|react-dom)(/|$)|^(node:)?(fs|path|process|window|document)$',
      },
    },
    {
      name: 'classfile-does-not-depend-on-execution',
      severity: 'error',
      from: { path: '^src/jvm/classfile/' },
      to: { path: '^src/jvm/(runtime|analysis)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: `${__dirname}/tsconfig.json` },
    enhancedResolveOptions: { exportsFields: ['exports'] },
  },
};
