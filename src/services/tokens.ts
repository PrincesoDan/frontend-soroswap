import axios from 'axios';
import soroAxios from './axios';

export const fetchTokens = async (network: string) => {
  let tokensList
  if (network === "mainnet") {
    const { data } = await axios.get('https://raw.githubusercontent.com/soroswap/token-list/main/tokenList.json')
    tokensList = data
  } else {
    const { data } = await soroAxios.get('/api/tokens');
    tokensList = data
  }
  
  return tokensList;
};
