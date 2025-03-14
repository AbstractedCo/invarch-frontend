import { InjectedAccountWithMeta } from "@polkadot/extension-inject/types";
import BigNumber from "bignumber.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import LoadingSpinner from "../components/LoadingSpinner";
import useApi from "../hooks/useApi";
import useAccount from "../stores/account";
import { Codec } from "@polkadot/types/types";
import { StakesInfo } from "./claim";
import MetricDashboard from "../components/MetricDashboard";
import { loadProjectDaos } from '../utils/stakingServices';
import DaoList from "../components/DaoList";
import Button from "../components/Button";
import useModal, { modalName } from "../stores/modals";
import { encodeAddress } from "@polkadot/util-crypto";
import { useQuery } from "urql";
import OnOffSwitch from "../components/Switch";
import { autoRestake } from "../utils/autoRestake";
import { restakeClaim } from "../utils/restakeClaim";
import { Balance } from "@polkadot/types/interfaces";
import { INVARCH_SS58 } from "../hooks/useConnect";
import { TOKEN_SYMBOL } from "../utils/consts";
import { useBalance } from "../providers/balance";

export type UnsubFunction = () => Promise<void>;

export type RewardQueryType = { latestClaimBlock: number; totalRewards: string; totalUnclaimed: string; };

export const TotalRewardsClaimedQuery = `
  query totalRewardsClaimed($accountId: String) {
    stakers(where: {account_eq: $accountId}) {
      latestClaimBlock
      totalRewards
      totalUnclaimed
    }
  }
`;

export const TotalRewardsClaimedSubscription = `
  subscription totalRewardsClaimed($accountId: String) {
    stakers(where: {account_eq: $accountId}) {
      latestClaimBlock
      totalRewards
      totalUnclaimed
    }
  }
`;

export const TotalRewardsDaoClaimedQuery = `
  query totalRewardsCoreClaimed($daoId: Int) {
    daos(where: {daoId_eq: $daoId}) {
      latestClaimBlock
      totalRewards
      totalUnclaimed
      daoId
    }
  }
`;

export const TotalRewardsCoreClaimedSubscription = `
  subscription totalRewardsCoreClaimed($daoId: Int) {
    daos(where: {daoId_eq: $daoId}) {
      latestClaimBlock
      totalRewards
      totalUnclaimed
      daoId
    }
  }
`;

export type StakingDao = {
  key: number;
  account: string;
  metadata: {
    name: string;
    description: string;
    image: string;
  };
};

export type TotalUserStakedData = { [key: number]: BigNumber | undefined; };

export type BalanceType = {
  nonce: string;
  consumers: string;
  providers: string;
  sufficients: string;
  data: {
    free: string;
    reserved: string;
    frozen: string;
  };
};

export type DaoEraStakeInfoType = {
  daoId: number;
  totalStaked: string;
  numberOfStakers: number;
  rewardClaimed: boolean;
  active: boolean;
};

export type DaoIndexedRewardsType = {
  daoId: number;
  totalRewards: string;
  totalUnclaimed: string;
};

export type CoreEraType = { daoId: number; earliestEra: number; };

export type UnclaimedErasType = {
  daos: CoreEraType[];
  total: number;
};

export type UserStakedInfoType = {
  daoId: number;
  era: number;
  staked: BigNumber;
};

export type ChainPropertiesType = {
  maxStakersPerDao: number;
  inflationErasPerYear: number;
};

export type LedgerType = {
  locked: number;
  unbondingInfo: {
    unlockingChunks: {
      amount: number;
      unlockEra: number;
    }[];
  };
};

export type LockedType = { locked: string; };

export type StakedType = { staked: string; };

export type DaoPrimitiveType = {
  account: string;
  metadata: {
    name: string;
    description: string;
    image: string;
  };
};

export function getTotalUserStaked(userStakedInfo: UserStakedInfoType[], dao: StakingDao) {
  return !!userStakedInfo && userStakedInfo.find(
    (info) => info.daoId === dao.key
  )?.staked;
}

export function getDaoInfo(daoEraStakeInfo: (DaoEraStakeInfoType)[], dao: StakingDao) {
  return !!daoEraStakeInfo && daoEraStakeInfo.find(
    (info) => info.daoId === dao.key
  );
}

const Staking = () => {
  const initialUnclaimed = useRef<BigNumber | null>(null);
  const api = useApi();
  const { reloadAccountInfo } = useBalance();
  const setOpenModal = useModal((state) => state.setOpenModal);
  const selectedAccount = useAccount((state) => state.selectedAccount);
  const [isLoading, setLoading] = useState(true);
  const [isWaiting, setWaiting] = useState(false);
  const [isDataLoaded, setDataLoaded] = useState(false);
  const [enableAutoRestake, setEnableAutoRestake] = useState<boolean>(false);
  const [claimAllSuccess, setClaimAllSuccess] = useState(false);
  const [stakingDaos, setStakingDaos] = useState<StakingDao[]>([]);
  const [currentStakingEra, setCurrentStakingEra] = useState<number>(0);
  const [totalUserStaked, setTotalUserStaked] = useState<BigNumber>();
  const [totalStaked, setTotalStaked] = useState<BigNumber>();
  const [totalSupply, setTotalSupply] = useState<BigNumber>();
  const [aggregateStaked, setAggregateStaked] = useState<BigNumber>();
  const [totalUnclaimed, setTotalUnclaimed] = useState<BigNumber>(new BigNumber(0));
  const [totalClaimed, setTotalClaimed] = useState<BigNumber>(new BigNumber(0));
  const [daoEraStakeInfo, setDaoEraStakeInfo] = useState<DaoEraStakeInfoType[]>([]);
  const [unclaimedEras, setUnclaimedEras] = useState<UnclaimedErasType>({ daos: [], total: 0 });
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  const [nextEraBlock, setNextEraBlock] = useState<number>(0);
  const [blocksPerEra, setBlocksPerEra] = useState<number>(0);
  const [userStakedInfoMap, setUserStakedInfoMap] = useState<Map<number, UserStakedInfoType>>(new Map());

  const disableClaiming = useMemo(() => {
    return isWaiting || unclaimedEras.total === 0 && totalUnclaimed.toNumber() === 0;
  }, [isWaiting, unclaimedEras, totalUnclaimed]);

  const [rewardsUserClaimedQuery, reexecuteQuery] = useQuery({
    query: TotalRewardsClaimedQuery,
    variables: {
      accountId: selectedAccount
        ? encodeAddress(selectedAccount.address, INVARCH_SS58)
        : null,
    },

    pause: !selectedAccount,
  });

  const setupSubscriptions = useCallback(async () => {
    if (!selectedAccount) {
      throw new Error("selectedAccount is null");
    };

    if (daoEraStakeInfo && daoEraStakeInfo.length > 0) {
      const promises = stakingDaos.map((stakingDao) =>
        api.query.ocifStaking.generalStakerInfo(
          stakingDao.key,
          selectedAccount.address,
          async (generalStakerInfo: Codec) => {
            const info = generalStakerInfo.toPrimitive() as StakesInfo;
            const latestInfo = info.stakes.at(-1);

            let era = -1;
            let staked = new BigNumber(0);

            if (info.stakes.length > 0) {
              const unclaimedEarliest = info.stakes.reduce((p, v) => parseInt(p.era) < parseInt(v.era) ? p : v).era;

              if (parseInt(unclaimedEarliest) <= currentStakingEra) {
                setUnclaimedEras(prevState => {
                  const unclaimedCore = prevState.daos.find(value => value.daoId === stakingDao.key);

                  if (unclaimedCore) {
                    unclaimedCore.earliestEra = parseInt(unclaimedEarliest);
                  } else {
                    prevState.daos.push({
                      daoId: stakingDao.key,
                      earliestEra: parseInt(unclaimedEarliest),
                    });
                  }

                  let total = prevState.total;
                  total = currentStakingEra - parseInt(unclaimedEarliest);

                  return {
                    daos: prevState.daos,
                    total,
                  };
                });
              } else {
                setUnclaimedEras(prevState => ({
                  ...prevState,
                  total: 0,
                }));
              }
            }

            if (latestInfo) {
              era = parseInt(latestInfo.era);
              staked = new BigNumber(latestInfo.staked);
            }

            setUserStakedInfoMap((currentMap) => {
              // Clone the current map to a new variable
              const updatedMap = new Map(currentMap);

              // Update the cloned map with new data
              updatedMap.set(stakingDao.key, {
                daoId: stakingDao.key,
                era: era,
                staked: staked,
              });

              // Return the updated map to be set as the new state
              return updatedMap;
            });

            const newTotalStaked = Array.from(
              userStakedInfoMap.values()
            ).reduce((acc, cur) => acc.plus(cur.staked), new BigNumber(0));

            setTotalUserStaked(newTotalStaked);
          }
        )
      );

      await Promise.all(promises);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, stakingDaos, selectedAccount, daoEraStakeInfo, currentStakingEra]);

  const loadCurrentEraAndStake = useCallback(async () => {
    const currentStakingEra = (await api.query.ocifStaking.currentEra()).toPrimitive() as number;
    const generalEraInfo = (await api.query.ocifStaking.generalEraInfo(currentStakingEra)).toPrimitive() as StakedType;
    const totalStaked = new BigNumber(generalEraInfo.staked);
    setCurrentStakingEra(currentStakingEra);
    setTotalStaked(totalStaked);
  }, [api]);

  const loadTotalSupply = useCallback(async () => {
    const supply = (await api.query.balances.totalIssuance()).toPrimitive() as string;
    setTotalSupply(new BigNumber(supply));
  }, [api]);

  const loadStakingConstants = useCallback(async () => {
    const blocksPerEra = api.consts.ocifStaking.blocksPerEra.toPrimitive() as number;
    setBlocksPerEra(blocksPerEra);

    await api.rpc.chain.subscribeNewHeads((header) => {
      setCurrentBlock(header.number.toNumber());
    });

    await api.query.ocifStaking.nextEraStartingBlock(
      (blockNumber: Codec) => {
        setNextEraBlock(blockNumber.toPrimitive() as number);
      }
    );

    if (currentStakingEra > 0) {
      await api.query.ocifStaking.generalEraInfo(
        currentStakingEra,
        (c: Codec) => {
          const stakingInfo = c.toPrimitive() as StakedType;

          setTotalStaked(new BigNumber(stakingInfo.staked));
        }
      );
    }
  }, [api, currentStakingEra]);

  const loadAggregateStaked = useCallback(async () => {
    const totalIssuance = (await api.query.balances.totalIssuance()).toPrimitive() as string;
    const inactiveIssuance = (await api.query.balances.inactiveIssuance()).toPrimitive() as string;
    setAggregateStaked(new BigNumber(totalIssuance).minus(new BigNumber(inactiveIssuance)));
  }, [api]);

  const loadCores = useCallback(async () => {
    const daos = await loadProjectDaos(api);

    if (daos) {
      setStakingDaos(daos);

      const daoEraStakeInfoMap: Map<
        number, DaoEraStakeInfoType> = new Map();

      const currentEra = await api.query.ocifStaking.currentEra();

      for (const stakingDao of daos) {
        const inf = await api.query.ocifStaking.coreEraStake(stakingDao.key, currentEra);

        const info: {
          total: string;
          numberOfStakers: number;
          rewardClaimed: boolean;
          active: boolean;
        } = inf.toPrimitive() as {
          total: string;
          numberOfStakers: number;
          rewardClaimed: boolean;
          active: boolean;
        };

        daoEraStakeInfoMap.set(stakingDao.key, {
          totalStaked: info.total,
          active: info.active,
          rewardClaimed: info.rewardClaimed,
          numberOfStakers: info.numberOfStakers,
          daoId: stakingDao.key
        });

        const coreEraStake = Array.from(daoEraStakeInfoMap.values());
        setDaoEraStakeInfo(coreEraStake);
      }
    }
  }, [api]);

  const initializeData = useCallback(async (selectedAccount: InjectedAccountWithMeta | null) => {
    try {
      toast.loading("Loading staking daos...");

      if (selectedAccount) {
        await Promise.all([
          loadCores(),
          loadCurrentEraAndStake(),
          loadStakingConstants(),
          loadTotalSupply(),
          loadAggregateStaked()
        ]);
      }
    } catch (error) {
      toast.dismiss();
      toast.error(`${error}`);
    } finally {
      toast.dismiss();
      toast.success('Loaded');
      setLoading(false);
      setDataLoaded(true);
    }
  }, [loadCores, loadStakingConstants, loadCurrentEraAndStake, loadTotalSupply, loadAggregateStaked]);

  const handleUnbondTokens = () => {
    setOpenModal({
      name: modalName.UNBOND_TOKENS,
    });
  };

  const handleRegisterProject = () => {
    setOpenModal({
      name: modalName.REGISTER_PROJECT,
    });
  };

  const handleAutoRestakeSwitch = (bool: boolean) => {
    setEnableAutoRestake(bool);
    autoRestake(bool);
  };

  const handleRestakingLogic = useCallback((partialFee?: Balance | undefined, stakedCores?: number) => {
    // Grab the total unclaimed rewards
    let unclaimedRewards = new BigNumber(totalUnclaimed);

    // Check if unclaimedRewards is a valid number
    if (isNaN(unclaimedRewards.toNumber())) {
      console.error("Invalid unclaimedRewards");
      return new BigNumber(0);
    }

    if (unclaimedRewards.toNumber() <= 0) {
      console.error("unclaimedRewards must be greater than 0");
      return new BigNumber(0);
    }

    // Check if stakedCores is a valid number and not zero to avoid division by zero
    if (stakedCores && (isNaN(stakedCores) || stakedCores === 0)) {
      console.error("Invalid stakedCores");
      return new BigNumber(0);
    }

    // Subtract partialFee * 1.20 from unclaimedRewards if partialFee exists
    if (partialFee) {
      unclaimedRewards = unclaimedRewards.minus(new BigNumber(partialFee.toString()).times(1.20));
    }

    // Divide unclaimedRewards by the number of stakedCores the user has staked tokens in
    const unclaimedPerCore = unclaimedRewards.div(stakedCores || 1);
    return unclaimedPerCore;
  }, [totalUnclaimed]);

  const refreshQuery = useCallback(() => {
    if (!claimAllSuccess) return;
    reexecuteQuery({ requestPolicy: 'network-only' });
    setClaimAllSuccess(false);
  }, [claimAllSuccess, reexecuteQuery]);

  const handleClaimRewards = useCallback(async () => {
    if (!selectedAccount || !unclaimedEras || !currentStakingEra) return;

    await restakeClaim({
      api,
      selectedAccount,
      unclaimedEras,
      currentStakingEra,
      enableAutoRestake,
      setWaiting,
      disableClaiming,
      handleRestakingLogic,
      userStakedInfoMap,
      callback: (result) => {
        if (!result) {
          // Halt if there is a restake error
          console.error("There was an error in restakeClaim");
          return;
        }

        if (initialUnclaimed.current !== null && initialUnclaimed.current > BigNumber(0)) {
          setTotalClaimed(prevTotalClaimed => prevTotalClaimed.plus(initialUnclaimed.current || new BigNumber(0)));
        }

        setTotalUnclaimed(new BigNumber(0));
        setUnclaimedEras({ daos: [], total: 0 });
        setClaimAllSuccess(true);
        refreshQuery();
        reloadAccountInfo();
      }
    });
  }, [api, currentStakingEra, enableAutoRestake, selectedAccount, unclaimedEras, userStakedInfoMap, handleRestakingLogic, disableClaiming, refreshQuery, reloadAccountInfo]);

  useEffect(() => {
    // Load auto-restake value from local storage
    const autoRestake = localStorage.getItem("autoRestake");
    if (autoRestake) {
      try {
        const parsedAutoRestake = JSON.parse(autoRestake);
        if (typeof parsedAutoRestake === 'boolean') {
          setEnableAutoRestake(parsedAutoRestake);
        } else {
          setEnableAutoRestake(false);
        }
      } catch (error) {
        setEnableAutoRestake(false);
      }
    } else {
      setEnableAutoRestake(false);
    }
  }, []);

  useEffect(() => {
    const setup = async () => {
      if (selectedAccount && typeof setupSubscriptions === 'function') {
        await setupSubscriptions();
      }
    };
    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, setupSubscriptions]);

  useEffect(() => {
    initializeData(selectedAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  useEffect(() => {
    if (rewardsUserClaimedQuery.fetching || !selectedAccount) return;

    if (!rewardsUserClaimedQuery.data?.stakers?.length) {
      setTotalClaimed(new BigNumber(0));
      setTotalUnclaimed(new BigNumber(0));
      return;
    }

    const rewardsClaimed = new BigNumber(
      rewardsUserClaimedQuery.data.stakers[0].totalRewards
    );
    setTotalClaimed(rewardsClaimed);

    const totalUnclaimed = new BigNumber(
      rewardsUserClaimedQuery.data.stakers[0].totalUnclaimed
    );
    setTotalUnclaimed(totalUnclaimed);
  }, [rewardsUserClaimedQuery, selectedAccount, rewardsUserClaimedQuery.fetching, rewardsUserClaimedQuery.data, claimAllSuccess]);

  return (
    <div className="mx-auto w-full flex max-w-7xl flex-col justify-between p-4 sm:px-6 lg:px-8 mt-14 md:mt-0 gap-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
        <h2 className="lg:text-xl font-bold leading-none my-3 flex flex-row items-center gap-4">
          <span>DAO Staking</span>
          <span>{isLoading || !isDataLoaded ? <LoadingSpinner /> : null}</span>
        </h2>

        {selectedAccount && <div className="flex flex-col md:flex-row w-full md:w-auto gap-2 items-stretch md:items-center justify-start z-1">
          <div className="mb-2 md:mb-0">
            <Button
              mini
              onClick={handleRegisterProject}
              disabled={isLoading}
              variant="primary">
              Register New DAO
            </Button>
          </div>
          <div>
            <Button
              mini
              onClick={handleUnbondTokens}
              disabled={isWaiting}
              variant="secondary">
              Claim Unbonded {`${TOKEN_SYMBOL}`}
            </Button>
          </div>
          <div className="flex flex-row items-center gap-1">
            <Button
              mini
              onClick={handleClaimRewards}
              disabled={disableClaiming}
              variant="primary">
              Claim {`${TOKEN_SYMBOL}`} Rewards
            </Button>
            <div className="flex flex-col items-center justify-around relative border-2 border-invarchGradientLightPurple text-invarchCream border-opacity-80 bg-invarchOffBlack bg-opacity-40 rounded-lg scale-70 lg:scale-90">
              <div className="flex-grow">
                <OnOffSwitch defaultEnabled={enableAutoRestake} onChange={(bool) => handleAutoRestakeSwitch(bool)} />
              </div>
              <span className="text-[.5rem] relative bottom-1">Auto-Restake</span>
            </div>
          </div>
        </div>}
      </div>

      {selectedAccount ? (
        <div>
          <MetricDashboard
            isOverview={false}
            vestingBalance={undefined}
            availableBalance={undefined}
            lockedBalance={undefined}
            aggregateStaked={aggregateStaked || new BigNumber(0)}
            totalUserStaked={totalUserStaked || new BigNumber(0)}
            totalSupply={totalSupply || new BigNumber(0)}
            totalStaked={totalStaked || new BigNumber(0)}
            totalUnclaimed={totalUnclaimed || new BigNumber(0)}
            totalClaimed={totalClaimed || new BigNumber(0)}
            currentStakingEra={currentStakingEra || 0}
            currentBlock={currentBlock}
            nextEraBlock={nextEraBlock}
            blocksPerEra={blocksPerEra}
            unclaimedEras={unclaimedEras}
          />

          <DaoList mini={false} isOverview={false} totalStakedInSystem={totalStaked || new BigNumber(0)} />
        </div>
      ) : <div className="text-center">
        <h5 className="text-sm font-bold text-invarchCream">
          Wallet not connected
        </h5>
        <p className="mt-2 text-xs text-invarchCream">
          Connect your wallet to view your staking information.
        </p>
      </div>}
    </div>
  );
};

export default Staking;
