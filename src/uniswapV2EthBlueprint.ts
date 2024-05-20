import { BlueprintRequest } from '../src/blueprint/blueprintRequest';
import { UniswapV2LikePositionValue } from '../src/common/uniswapV2LikePositionValue';
import { DefaultZapAwareTransferLogTransformer } from '../src/transferLogTransformers/defaultZapAwareTransferLogTransformer';
import { UniswapEthTransactionClassifier } from './uniswapEthTransactionClassifier';
import { UniswapV2EthGraphExplorer } from './uniswapV2EthGraphExplorer';
import {
  Blueprint,
  BlueprintContext,
  Classification,
  MetadataStore,
  PositionContext,
  PositionValue,
  TimeContext,
  TransactionDetails,
  UserTransactionResults,
} from 'blueprint-lib';

export default class UniswapV2EthBlueprint implements Blueprint {
  readonly protocolKey: string = 'uniswap_v2_eth';
  private blueprintRequest: BlueprintRequest;

  constructor(private context: BlueprintContext) {}

  getTestWalletAddresses(): string[] {
    return [
      '0x6E0e92F0d5A375D92CF9Be3FE5d9d67eca5e0ae3', // Partial exit
      '0x627ca7601e943cbffd21aeeb7bb06b9a3137b0ec', // Re-entering after full exit
    ];
  }

  syncMetadata(_metadataStore: MetadataStore, _lastSyncAt: number): Promise<number> {
    return Promise.resolve(0);
  }

  syncMetadataInterval(): number {
    return 0;
  }

  getParentBlueprintId(): string {
    return '';
  }

  async getUserTransactions(
    context: BlueprintContext,
    userAddresses: string[],
    fromBlock: number,
  ): Promise<UserTransactionResults> {
    this.blueprintRequest = new BlueprintRequest(context, 'uniswap_eth', userAddresses);
    return new UniswapV2EthGraphExplorer(context, context.getAxiosManager()).getUserTxnHistory(
      userAddresses,
      this.protocolKey,
      fromBlock,
    );
  }

  async classifyTransaction(context: BlueprintContext, txn: TransactionDetails): Promise<Classification[]> {
    return (
      (await new DefaultZapAwareTransferLogTransformer(context).classifyTransaction(this.blueprintRequest, txn)) ||
      (await new UniswapEthTransactionClassifier(context).classifyTransaction(this.blueprintRequest, txn))
    );
  }

  getContractName(): string {
    return 'Uniswap v2';
  }

  getBlueprintKey(): string {
    return this.protocolKey;
  }

  getContext(): BlueprintContext {
    return this.context;
  }

  getBlueprintCategory(): string {
    return 'dex';
  }

  async getCurrentPositionValue(positionContext: PositionContext): Promise<PositionValue> {
    return new UniswapV2LikePositionValue(this.context.getConfigService()).getPositionValue(
      positionContext,
      'uniswap_eth',
    );
  }

  async getPositionValueAt(positionContext: PositionContext, { blockNumber }: TimeContext): Promise<PositionValue> {
    return new UniswapV2LikePositionValue(this.context.getConfigService()).getPositionValue(
      positionContext,
      'uniswap_eth',
      blockNumber,
    );
  }

  async getUserList(_fromBlock: number): Promise<string[]> {
    return [];
  }
}
