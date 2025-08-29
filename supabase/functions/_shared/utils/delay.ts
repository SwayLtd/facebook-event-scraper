// Utility function for delay
// Adaptation simple du delay JavaScript local

export const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export default delay;
