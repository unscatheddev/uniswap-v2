import { BlueprintContext } from 'blueprint-lib';

export async function axiosGet(context: BlueprintContext, url: string) {
  const axios = context.getAxios();
  return await axios.get(url);
}
export async function axiosPost(context: BlueprintContext, url: string, data: any) {
  const axios = context.getAxios();
  return axios.post(url, data);
}

export async function queryLastSyncedBlock(context: BlueprintContext, subgraphUrl: string): Promise<number> {
  try {
    const payload = `{ _meta { block { number } } }`;
    const response = (await axiosPost(context, subgraphUrl, { query: payload })).data;
    return parseInt(response.data._meta.block.number);
  } catch (e) {
    context.getLogger().error(`queryLastSyncedBlock failed for subgraph ${subgraphUrl}. Error: ${e}`);
    return null;
  }
}
