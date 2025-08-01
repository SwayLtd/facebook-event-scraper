// utils/delay.js
// Utility function for delay

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export { delay };
