import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { BigNumber } from 'bignumber.js';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { StakingDao, DaoEraStakeInfoType, ChainPropertiesType, DaoIndexedRewardsType } from '../routes/staking';
import { InjectedAccountWithMeta } from '@polkadot/extension-inject/types';
import TotalStakersIcon from '../assets/invarch/total-stakers-icon-light.svg';
import TotalStakedIcon from '../assets/invarch/total-staked-icon-light.svg';
import MyProjectStakeIcon from '../assets/invarch/my-project-stake-icon-light.svg';
import ClaimedRewardsIcon from '../assets/invarch/claimed-rewards-icon-light.svg';
import UnclaimedRewardsIcon from '../assets/invarch/unclaimed-rewards-icon-light.svg';
import SupportShareIcon from '../assets/invarch/support-share-icon-light.svg';
import MinSupportIcon from '../assets/invarch/min-support-icon-light.svg';
import Avatar from './Avatar';
import { AnyJson } from '@polkadot/types/types';
import useApi from '../hooks/useApi';
import { formatNumberShorthand } from '../utils/formatNumber';
import Button from './Button';
import { HOVER_GRADIENT, TOKEN_SYMBOL } from '../utils/consts';
import { StakingMetadata } from '../modals/ManageStaking';
import { web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { getSignAndSendCallbackWithPromise } from "../utils/getSignAndSendCallback";

export interface ProjectCardProps {
  dao: StakingDao;
  totalUserStaked: BigNumber | undefined;
  daoInfo: Partial<DaoEraStakeInfoType> | undefined;
  coreRewards: Partial<DaoIndexedRewardsType> | undefined;
  chainProperties: ChainPropertiesType | undefined;
  handleManageStaking: (args: StakingMetadata) => void;
  handleViewDetails?: (mini: boolean) => void;
  descriptionRef: RefObject<HTMLDivElement>;
  toggleExpanded: (dao: StakingDao) => void;
  toggleViewMembers: (dao: StakingDao, members: AnyJson[]) => void;
  selectedAccount: InjectedAccountWithMeta | null;
  members: AnyJson[];
  mini: boolean;
  totalStakedInSystem: BigNumber;
  allDaos: StakingDao[];
}

const STAT_UNDERLINE = `border-b border-b-invarchCream border-opacity-20`;

const ProjectCard = (props: ProjectCardProps) => {
  const {
    dao: core,
    totalUserStaked: totalStaked,
    daoInfo,
    coreRewards,
    chainProperties,
    // availableBalance,
    handleManageStaking,
    handleViewDetails,
    descriptionRef,
    toggleExpanded,
    toggleViewMembers,
    selectedAccount,
    members,
    mini,
    totalStakedInSystem,
    allDaos
  } = props;
  const api = useApi();
  const scrollPositionRef = useRef(0);
  const [isHovered, setIsHovered] = useState(false);
  const [minSupportMet, setMinSupportMet] = useState(false);
  // const [aggregateStaked, setAggregateStaked] = useState<BigNumber>(new BigNumber(0));
  const [minStakeReward, setMinStakeReward] = useState<BigNumber>(new BigNumber(0));
  const [totalUserStaked, setTotalUserStaked] = useState<BigNumber>(new BigNumber(0));
  const [daoUnclaimedEras, setDaoUnclaimedEras] = useState<{ min: number, max: number }>({ min: 0, max: 0 });

  const handleReadMore = (event: React.MouseEvent) => {
    event.stopPropagation();

    setIsHovered(!isHovered);
    toggleExpanded(core);
  };

  const handleViewMembers = (event: React.MouseEvent) => {
    event.stopPropagation();

    toggleViewMembers(core, members);
  };

  // const loadAggregateStaked = useCallback(async () => {
  //   const totalIssuance = (await api.query.balances.totalIssuance()).toPrimitive() as string;
  //   const inactiveIssuance = (await api.query.balances.inactiveIssuance()).toPrimitive() as string;
  //   setAggregateStaked(new BigNumber(totalIssuance).minus(new BigNumber(inactiveIssuance)));
  // }, [api]);

  const loadStakeRewardMinimum = useCallback(() => {
    const minStakeReward = api.consts.ocifStaking.stakeThresholdForActiveDao.toPrimitive() as string;
    setMinStakeReward(new BigNumber(minStakeReward));
  }, [api]);

  const calcMinSupportMet = useCallback(() => {
    if (minStakeReward.isLessThan(daoInfo?.totalStaked || new BigNumber(0))) {
      setMinSupportMet(true);
    } else {
      setMinSupportMet(false);
    }
  }, [minStakeReward, daoInfo]);

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();

    const parsedTotalStaked = totalUserStaked || new BigNumber(0);

    if (handleViewDetails && mini) {
      handleViewDetails(mini);
      return;
    }

    handleManageStaking({
      dao: core,
      totalUserStaked: parsedTotalStaked,
      allDaos
    });
  };

  useEffect(() => {
    api.query.ocifStaking.coreEraStake.entries(core.key).then((coreEraStake) => {
      const unclaimedEras = coreEraStake
        .filter(([_, era]) => (era.toHuman() as { rewardClaimed: boolean }).rewardClaimed == false)
        .map(([key, _]) => key.args[1].toHuman() as number);

      const min = Math.min(...unclaimedEras);

      // Max is current era, so we subtract 1.
      const max = Math.max(...unclaimedEras) - 1;

      setDaoUnclaimedEras({ min, max });
    });
  }, [api, core, daoUnclaimedEras]);

  const claimCoreRewards = async (event: React.MouseEvent) => {
    event.stopPropagation();

    const { min, max } = daoUnclaimedEras;

    console.log("min: ", min, "max: ", max);

    if (!selectedAccount || (max - min <= 0)) return;

    const batch = [];

    for (let era = min; era <= max; era++) {
      batch.push(api.tx.ocifStaking.daoClaimRewards(core.key, era));
    }

    try {

      await web3Enable("Tinkernet");

      const injector = await web3FromAddress(selectedAccount.address);

      await api.tx.utility.batch(batch).signAndSend(
        selectedAccount.address,
        { signer: injector.signer },
        getSignAndSendCallbackWithPromise({
          onExecuted: () => {
            toast.dismiss();
            toast.loading("Waiting for confirmation...");
          },
          onSuccess: () => {
            toast.dismiss();
            toast.success("Claimed successfully");
          },
          onDropped: () => {
            toast.dismiss();
            toast.error("Error claiming DAO rewards.");
          },
          onError: (error) => {
            toast.dismiss();
            toast.error("Error claiming DAO rewards.");
            console.error(error);
          },
          onInterrupt: (error) => {
            toast.dismiss();
            toast.error("Error claiming DAO rewards.");
            console.error(error);
          },
          onInvalid: () => {
            toast.dismiss();
            toast.error("Error claiming DAO rewards.");
          },
        }, api)
      );

    } catch (error) {
      toast.dismiss();
      toast.error("Error claiming DAO rewards.");
      console.error(error);
    }
};

  const handleStatsHover = useCallback((isHovering: boolean, statClass: string, e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();

    if (mini) return;

    const elements = document.querySelectorAll(`.${statClass}`);
    elements.forEach(element => {
      const htmlElement = element as HTMLElement;
      if (isHovering) {
        htmlElement.style.backgroundImage = HOVER_GRADIENT;
      } else {
        htmlElement.style.backgroundImage = '';
      }
    });
  }, [mini]);

  useEffect(() => {
    // loadAggregateStaked();
    loadStakeRewardMinimum();
  }, [
    // loadAggregateStaked, 
    loadStakeRewardMinimum]);

  useEffect(() => {
    calcMinSupportMet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minStakeReward, daoInfo?.totalStaked]);

  useEffect(() => {
    if (totalStaked !== undefined) {
      setTotalUserStaked(totalStaked);
    }
  }, [totalStaked]);

  const statsSection = <div className={`relative stats-section grid grid-cols-1`}>

    {/* Total Stakers */}
    {!mini ? <div
      className={`p-2 stats-1 flex justify-between items-center ${STAT_UNDERLINE}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-1', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-1', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-1', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-1', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={TotalStakersIcon} alt="Total Stakers Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Total Stakers
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] flex flex-row items-center gap-1">
        {(daoInfo?.numberOfStakers || 0) >=
          (chainProperties?.maxStakersPerDao || 0) ? (
          <LockClosedIcon
            className="h-3 w-3 cursor-pointer text-invarchCream"
            onClick={() => {
              toast.error(
                "This core has reached the staker limit"
              );
            }}
          />
        ) : null}
        <span>{daoInfo?.numberOfStakers}</span>
      </div>
    </div> : null}

    {/* Total Staked */}
    {!mini ? <div
      className={`p-2 stats-2 flex justify-between items-center ${STAT_UNDERLINE}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-2', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-2', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-2', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-2', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={TotalStakedIcon} alt="Total Staked Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Total Staked
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] truncate">
        {daoInfo?.totalStaked
          ? `${formatNumberShorthand(parseFloat(daoInfo?.totalStaked.toString()) / Math.pow(10, 12))} ${TOKEN_SYMBOL}`
          : '--'}
      </div>
    </div> : null}

    {/* My Stake */}
    <div
      className={`p-2 stats-3 flex justify-between items-center ${!mini ? STAT_UNDERLINE : ''}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-3', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-3', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-3', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-3', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={MyProjectStakeIcon} alt="My Project Stake Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          My Stake
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] truncate">
        {totalUserStaked
          ? `${formatNumberShorthand(parseFloat(totalUserStaked.toString()) / Math.pow(10, 12))} ${TOKEN_SYMBOL}`
          : '--'}
      </div>
    </div>

    {/* Total Rewards */}
    {!mini ? <div
      className={`p-2 stats-4 flex justify-between items-center ${STAT_UNDERLINE}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-4', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-4', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-4', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-4', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={ClaimedRewardsIcon} alt="Total Staked Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Claimed Rewards
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] truncate">
        {coreRewards?.totalRewards
          ? `${formatNumberShorthand(parseFloat(coreRewards?.totalRewards.toString()) / Math.pow(10, 12))} ${TOKEN_SYMBOL}`
          : '--'}
      </div>
    </div> : null}

    {/* Unclaimed Rewards */}
    {!mini ? <div
      className={`p-2 stats-5 flex justify-between items-center ${STAT_UNDERLINE}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-5', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-5', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-5', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-5', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={UnclaimedRewardsIcon} alt="Total Staked Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Unclaimed Rewards
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] truncate">
        {coreRewards?.totalUnclaimed
          ? `${formatNumberShorthand(parseFloat(coreRewards?.totalUnclaimed.toString()) / Math.pow(10, 12))} ${TOKEN_SYMBOL}`
          : '--'}
      </div>
    </div> : null}

    {/* Support Share */}
    {!mini ? <div
      className={`p-2 stats-6 flex justify-between items-center ${STAT_UNDERLINE}`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-6', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-6', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-6', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-6', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={SupportShareIcon} alt="Total Staked Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Support Share
        </div>
      </div>
      <div className="font-normal text-invarchCream text-[12px] text-right tracking-[0] leading-[normal] truncate">
        {daoInfo?.totalStaked
          ? `${new BigNumber(daoInfo?.totalStaked).times(100).div(totalStakedInSystem).toFixed(2)}%`
          : '--'}
      </div>
    </div> : null}

    {/* Minimum Support */}
    {!mini ? <div
      className={`p-2 stats-7 flex justify-between items-center`}
      onMouseEnter={(e) => handleStatsHover(true, 'stats-7', e)}
      onMouseLeave={(e) => handleStatsHover(false, 'stats-7', e)}
      onTouchStart={(e) => handleStatsHover(true, 'stats-7', e)}
      onTouchEnd={(e) => handleStatsHover(false, 'stats-7', e)}
    >
      <div className='flex flex-row items-center gap-2'>
        <div className="w-5 h-5 rounded-full bg-invarchPink bg-opacity-40 flex items-center justify-center">
          <img src={MinSupportIcon} alt="Total Staked Icon" className='w-3 h-auto p-[1px]' />
        </div>
        <div className="font-normal text-invarchCream text-[12px] tracking-[0] leading-[normal]">
          Min. Support Met
        </div>
      </div>
      <div className="text-invarchCream font-normal text-[12px] text-right tracking-[0] leading-[normal] truncate">
        <span className={`${minSupportMet ? 'text-green-400' : 'text-red-400'}`}>
          {daoInfo?.totalStaked && minStakeReward
            ? `${minSupportMet ? formatNumberShorthand(parseFloat(minStakeReward.toString()) / Math.pow(10, 12)) : formatNumberShorthand(parseFloat(daoInfo?.totalStaked.toString()) / Math.pow(10, 12))}/${formatNumberShorthand(parseFloat(minStakeReward.toString()) / Math.pow(10, 12))}`
            : '--'}
        </span> {`${TOKEN_SYMBOL}`}
      </div>
    </div> : null}
  </div>;

  return (
    <div
      key={core.account}
      className={`flex flex-col justify-between w-full rounded-xl space-y-4 border border-invarchCream border-opacity-20 bg-invarchOffBlack bg-opacity-70 backdrop-blur-sm`}>
      <div className={`relative p-8 flex flex-col gap-6 justify-start h-auto`}>

        {/* Avatar, Name, Members */}
        <div className="flex items-center space-x-4">
          <Avatar src={core.metadata.image} alt="Project Image" />
          <div className="flex flex-col items-start gap-1 justify-start text-ellipsis truncate">
            <h4 className="font-bold text-invarchCream text-[18px] text-left tracking-[0] leading-none truncate">
              {core.metadata.name}
            </h4>
            {!mini ? <span onClick={handleViewMembers} className={`text-xs text-invarchCream/50  hover:text-invarchGradientYellow cursor-pointer`}>Members: <span className='underline underline-offset-2'>{members ? members.length : 0}</span></span> : null}
          </div>
        </div>

        {/* Description */}
        {!mini ? <div ref={descriptionRef} className={`relative bg-invarchPink bg-opacity-10 rounded-lg p-4 h-28 hover:cursor-pointer border border-px border-invarchCream border-opacity-10 shadow-lg`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={handleReadMore}>
          <div className={`absolute inset-0 flex justify-center items-center font-normal text-invarchGradientYellow text-[12px] tracking-[0] leading-[normal] ${isHovered ? 'opacity-100 underline underline-offset-2' : 'md:opacity-0 opacity-100 underline underline-offset-2'} z-10 pointer-events-none`}>
            Show More
          </div>
          <p className={`font-normal text-invarchCream text-[14px] tracking-[0] leading-[18px] line-clamp-4 gradient-bottom hover:text-opacity-20 text-opacity-20 md:text-opacity-100`}>
            {core.metadata.description}
          </p>
        </div> : null}

        <div
          className={`relative stats-section grid grid-cols-1 gap-2 ${mini ? '' : 'h-28'} overflow-y-scroll tinker-scrollbar scrollbar-thumb-invarchPink scrollbar pr-3`}
          onScroll={(e) => {
            // Update the stored scroll position
            scrollPositionRef.current = (e.target as HTMLElement).scrollTop;

            // Select all stats-section divs
            const statsSections = document.querySelectorAll('.stats-section');

            // Set the scroll position of all stats-section divs
            statsSections.forEach((statsSection) => {
              statsSection.scrollTop = scrollPositionRef.current;
            });
          }}>
          {statsSection}
        </div>

        <div className="flex flex-col md:flex-row w-full md:w-auto gap-2 items-stretch md:items-center justify-start z-1">

        {selectedAccount ? <Button variant='primary' mini={true} onClick={handleClick}
          disabled={
            (daoInfo?.numberOfStakers || 0) >=
            (chainProperties?.maxStakersPerDao || 0) &&
            !totalUserStaked
          }>{!mini ? 'Manage Staking' : 'View Details'}</Button> : null}

        {(!mini && members.includes(selectedAccount?.address)) ? <Button variant='primary'
            mini={true}
            disabled={core.key == 0 || (daoUnclaimedEras.max - daoUnclaimedEras.min) <= 0}
            onClick={claimCoreRewards}
            >Claim DAO Rewards</Button> : null
          }
        </div>

      </div>
    </div>
  );
};

export default ProjectCard;
