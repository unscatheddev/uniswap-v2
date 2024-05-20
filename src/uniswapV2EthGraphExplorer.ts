import { formatStringArrayForSubgraph } from '../src/common/lib/utils';
import { queryLastSyncedBlock } from '../src/common/lib/requestUtils';
import { ApAxiosManager, ApGraphQLManager } from 'archive-axios';
import { TransactionDetails, UserTransactionResults,LogLevel, BlueprintContext } from 'blueprint-lib';

export class UniswapV2EthGraphExplorer extends ApGraphQLManager {
  constructor(
    private context: BlueprintContext,
    axiosManager: ApAxiosManager,
  ) {
    const subgraphUrl =
      'https://gateway-arbitrum.network.thegraph.com/api/515cfc7f0c80a6e155e5dd569b5cb316/subgraphs/id/HfEpJSzVc3ZEmLi9sc96boUM8dzECn2HvzYnAAdLGNUE';
    super(axiosManager, subgraphUrl);
  }

  // this subgraph uses poolProviderKey 'uniswap_eth' instead of blueprint key 'uniswap_v2_eth'
  private readonly PROVIDER_KEY = 'uniswap_eth';

  async getUserTxnHistory(
    userAddresses: string[],
    protocolKey: string,
    blockNumber: number,
  ): Promise<UserTransactionResults> {
    const formattedAddresses = formatStringArrayForSubgraph(userAddresses);
    try {
      const payload = `{ userLPTransactions(first:1000, orderBy: blockNumber, orderDirection: asc, where: {blockNumber_gt: ${blockNumber}, user_in: ${formattedAddresses}, poolProviderKey: "${this.PROVIDER_KEY}"}) { blockNumber transactionHash poolAddress poolProviderKey timestamp } }`;
      const res = (await this.executeGraphQLQueryOrThrowError(payload)) as any;

      const lastSyncedBlock = (await queryLastSyncedBlock(this.context, this['subgraphURL'])) || -1;
      const data = res.data;
      if (data) {
        const txnResults = data.userLPTransactions;
        if (txnResults && txnResults.length > 0) {
          const txns = txnResults.map(
            (item) => new TransactionDetails(item.transactionHash, Number(item.blockNumber), Number(item.timestamp)),
          );
          return new UserTransactionResults(txns, lastSyncedBlock);
        }

        return new UserTransactionResults([], lastSyncedBlock);
      }

      return new UserTransactionResults([], -1);
    } catch (error) {
      this.context
        .getLogger()
        .log(
          LogLevel.ERROR,
          `Could not get ${protocolKey} transactions for users ${userAddresses} from block ${blockNumber}`,
        );
      return new UserTransactionResults([], -1);
    }
  }

  async getUserPositions(context: BlueprintContext, userAddress: string, protocolKey: string): Promise<string[]> {
    return await context.cacheOrPerform(
      `USER_LP_POSITIONS_${userAddress}_${this.PROVIDER_KEY}`,
      async () => {
        try {
          const payload = `{ liquidityPositions(first:1000, where: {user: "${userAddress.toLowerCase()}", poolProviderKey: "${
            this.PROVIDER_KEY
          }"}) { poolAddress } }`;
          const res = (await this.executeGraphQLQueryOrThrowError(payload)) as any;
          const data = res.data;
          if (data) {
            const positions = data.liquidityPositions;
            if (positions && positions.length > 0) {
              return positions.map((pos) => pos.poolAddress);
            }

            return null;
          } else {
            return null;
          }
        } catch (error) {
          this.context
            .getLogger()
            .log(
              LogLevel.ERROR,
              `Could not get the ${protocolKey} liquidity positions for user ${userAddress}. Error: ${error}`,
            );
          return null;
        }
      },
    );
  }
}
