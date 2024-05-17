import { L2TransactionReceipt } from '../types/transactionReceipts';
import BigNumber from 'bignumber.js';
import { BlueprintContext, Operation, OperationType, PositionShares, TokenInfo, TokenTag } from 'blueprint-lib';
import { ethers } from 'ethers';

export function formatStringArrayForSubgraph(strings: string[]): string {
  return `[${strings.map((s) => `"${s.toLowerCase()}"`)}]`;
}
export function isDepositOrWithdraw(operationType: OperationType): boolean {
  return isDepositOp(operationType) || isWithdrawOp(operationType);
}

export function isDepositOrTransferIn(operationType: OperationType): boolean {
  return isDepositOp(operationType) || isTransferInOp(operationType);
}
export function isWithdrawOrTransferOut(operationType: OperationType): boolean {
  return isWithdrawOp(operationType) || isTransferOutOp(operationType);
}

export function isDepositOp(operationType: OperationType): boolean {
  return operationType === OperationType.DEPOSIT;
}

export function isWithdrawOp(operationType: OperationType): boolean {
  return operationType === OperationType.WITHDRAW;
}

export function isTransferInOp(operationType: OperationType): boolean {
  return operationType === OperationType.TRANSFER_IN;
}
export function isTransferOutOp(operationType: OperationType): boolean {
  return operationType === OperationType.TRANSFER_OUT;
}
export function addTrackedUnderlyingTag(tokens: TokenInfo[]): TokenInfo[] {
  tokens.forEach((token) => (token.tag = TokenTag.TRACKED_UNDERLYING));
  return tokens;
}

export function isCustomTransactionReceipt(
  receipt: ethers.providers.TransactionReceipt,
): receipt is L2TransactionReceipt {
  return 'l1GasUsed' in receipt && 'l1GasPrice' in receipt && 'l1FeeScalar' in receipt;
}

export function transformProviderKey(providerKey: string): string {
  if (!providerKey) {
    return '';
  }
}

export function extractPositionSharesDefaultStrategy(
  inputTokens: TokenInfo[],
  outputTokens: TokenInfo[],
  sharesIdentifier: string,
): PositionShares[] {
  const sharesInfo = [...inputTokens, ...outputTokens].find((token) => token.identifier === sharesIdentifier);
  if (sharesInfo) {
    return [new PositionShares(sharesInfo.identifier, sharesInfo.priceUsd)];
  }

  return [new PositionShares(sharesIdentifier)];
}

export function extractOperationDefaultStrategy(
  inputTokens: TokenInfo[],
  outputTokens: TokenInfo[],
  sharesIdentifier: string,
  operationType: OperationType,
): Operation {
  const sharesInfo = [...inputTokens, ...outputTokens].find((token) => token.identifier === sharesIdentifier);
  if (sharesInfo) {
    let amount = BigNumber(0);
    switch (operationType) {
      case OperationType.WITHDRAW:
      case OperationType.TRANSFER_OUT:
        amount = sharesInfo.amount.negated();
        break;
      case OperationType.DEPOSIT:
      case OperationType.TRANSFER_IN:
        amount = sharesInfo.amount;
        break;
    }

    return new Operation(operationType, inputTokens, outputTokens, amount);
  }

  return new Operation(operationType, inputTokens, outputTokens);
}

export class UniV2UnderlyingTokenAmountsParams {
  constructor(
    public positionIdentifier: string,
    public blockNumber: number,
    public positionShares: BigNumber,
    public blueprintKey: string,
  ) {}
}

export async function getUniV2LikeUnderlyingTokenAddresses(
  context: BlueprintContext,
  positionIdentifier?: string,
): Promise<string[]> {
  return await context.getContractReader().getToken01(positionIdentifier);
}

export async function getUniV2LikeUnderlyingTokenAmounts(
  context: BlueprintContext,
  params: UniV2UnderlyingTokenAmountsParams,
): Promise<TokenInfo[]> {
  const evmContractReader = context.getContractReader();
  const exchangePrice = context.getExchangePrice();
  const { positionIdentifier, blockNumber, positionShares, blueprintKey } = params;

  const underlyingTokenAddresses = await getUniV2LikeUnderlyingTokenAddresses(context, positionIdentifier);
  const poolSupply = await evmContractReader.getPoolSupply(underlyingTokenAddresses, positionIdentifier, blockNumber);
  const ownedPct = poolSupply.totalSupply.gt(0) ? positionShares.div(poolSupply.totalSupply) : BigNumber(0);

  const underlyingTokens = [];
  for (const tokenAddress of underlyingTokenAddresses) {
    const tokenSupply = poolSupply.underlyingTokenSupplies.find(
      (token) => token.address.toLowerCase() == tokenAddress.toLowerCase(),
    );
    const tokenAmount = tokenSupply ? tokenSupply.balance.multipliedBy(ownedPct) : BigNumber(0);
    const tokenPriceObj = await exchangePrice.getPriceOfAt(tokenAddress, blueprintKey, blockNumber);
    underlyingTokens.push(new TokenInfo(tokenAddress, tokenPriceObj.price, tokenAmount, tokenPriceObj.source));
  }

  return underlyingTokens;
}
export function createNilPositionShares(): PositionShares[] {
  return [new PositionShares('', 0, null, false)];
}
