import BigNumber from 'bignumber.js';

/**
 * Class that encapsulates information about a Transfer. Note that all values are being downcased by the time it comes into here.
 */
export class TransferLogDetails {
  constructor(
    public tokenAddress: string,
    public from: string,
    public to: string,
    public value: BigNumber,
  ) {
    this.tokenAddress = tokenAddress.toLowerCase();
    this.from = from.toLowerCase();
    this.to = to.toLowerCase();
  }
}
