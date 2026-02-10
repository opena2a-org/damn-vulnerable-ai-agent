import { BEST_PRACTICES_LIBRARY, getExample, getAllExamples } from './library.js';

console.assert(BEST_PRACTICES_LIBRARY.length === 5, 'Should have 5 examples');
console.assert(getExample('insecure-basic').expectedScore === 30, 'Should find example by ID');
console.assert(getAllExamples().length === 5, 'Should return all examples');

console.log('✅ Library tests passed');
