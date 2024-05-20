import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'ethers';

export interface L2TransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasUsed?: BigNumber;
  l1GasPrice?: BigNumber;
  l1FeeScalar?: BigNumber;
  l1Fee?: BigNumber;
}
