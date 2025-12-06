/* eslint-disable import/no-anonymous-default-export */
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
import { getBabelOutputPlugin } from '@rollup/plugin-babel';

export default [
  {
    input: 'worker/index.ts',
    output: [
      {
        file: 'public/pitch-detection/worker.js',
        format: 'iife',
      },
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: false,
        include: ['worker/**/*'],
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          declaration: false,
          skipLibCheck: true,
        }
      }),
      // getBabelOutputPlugin removed
      copy({
        targets: [
          { src: '../wasm/pkg/**.wasm', dest: 'public/pitch-detection' },
        ],
      }),
    ],
  },
];
