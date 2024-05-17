import {
  UniV2UnderlyingTokenAmountsParams,
  createNilPositionShares,
  getUniV2LikeUnderlyingTokenAmounts,
} from './lib/utils';
import { ConfigService } from '@nestjs/config';
import BigNumber from 'bignumber.js';
import {
  OperationType,
  PositionContext,
  PositionShares,
  PositionValue,
  TokenInfo,
  UserProtocolPositionSnapshot,
} from 'blueprint-lib';

export class UniswapV2LikePositionValue {
  constructor(private configService: ConfigService) {}

  async getPositionValue(
    positionContext: PositionContext,
    blueprintKey: string,
    blockNumber: number = 0,
  ): Promise<PositionValue> {
    const { context, positionSnapshots, positionIdentifier } = positionContext;
    if (positionSnapshots.length == 0) {
      return new PositionValue(0, createNilPositionShares());
    }

    const lastValidSnapshot = this.getLastValidSnapshot(positionSnapshots);
    const [receiptTokenObj, underlyingTokenAmounts] = await Promise.all([
      context.getExchangePrice().getReceiptTokenPriceAt(positionIdentifier, blueprintKey, blockNumber),
      this.getUnderlyingTokenAmounts(positionContext, blockNumber, blueprintKey),
    ]);

    const positionValueUsd = this.getPositionValueUsd(lastValidSnapshot, receiptTokenObj.price, underlyingTokenAmounts);

    const positionShares = new PositionShares(positionIdentifier, receiptTokenObj.price);

    const msg = `calculated PositionValue : ${JSON.stringify({
      hash: lastValidSnapshot.txHash,
      positionValueUsd,
      positionIdentifier,
      blockNumber,
      receiptTokenObj,
      positionBalance: lastValidSnapshot.positionSharesAtBlock,
    })}`;
    positionContext.context.getLogger().debug(msg);

    return new PositionValue(positionValueUsd, [positionShares], [], underlyingTokenAmounts);
  }

  private getPositionValueUsd(
    lastValidSnapshot: UserProtocolPositionSnapshot,
    receiptTokenPrice: number,
    underlyingTokenAmounts: TokenInfo[],
  ) {
    if (receiptTokenPrice === 0) {
      // if we fail to fetch receipt token price for some reason
      // we fallback to returning sum of underlying tokens times their respective prices at block
      return underlyingTokenAmounts.reduce((prev, curr) => prev + curr.amount.times(curr.priceUsd).toNumber(), 0);
    }

    return lastValidSnapshot.positionSharesAtBlock.multipliedBy(BigNumber(receiptTokenPrice)).toNumber();
  }

  private async getUnderlyingTokenAmounts(
    { context, positionSnapshots, positionIdentifier }: PositionContext,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    const lastValidSnapshot = this.getLastValidSnapshot(positionSnapshots);

    const params = new UniV2UnderlyingTokenAmountsParams(
      positionIdentifier,
      blockNumber,
      lastValidSnapshot.positionSharesAtBlock,
      blueprintKey,
    );

    return await getUniV2LikeUnderlyingTokenAmounts(context, params);
  }

  private getLastValidSnapshot(positionSnapshots: UserProtocolPositionSnapshot[]): UserProtocolPositionSnapshot {
    if (positionSnapshots.length === 1) {
      return positionSnapshots[0];
    }

    const validSnapshots = positionSnapshots.filter((snapshot) =>
      snapshot.userProtocolPositionSnapshotOperations.find((operation) =>
        [OperationType.WITHDRAW, OperationType.DEPOSIT, OperationType.TRANSFER_IN, OperationType.TRANSFER_OUT].includes(
          operation.operationType,
        ),
      ),
    );
    return validSnapshots[validSnapshots.length - 1];
  }
}
