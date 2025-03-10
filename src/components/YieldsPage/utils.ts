import { YieldsData } from '~/api/categories/yield'
import { attributeOptions } from '~/components/Filters'

export function toFilterPool({
	curr,
	selectedProjects,
	selectedChains,
	selectedAttributes,
	includeTokens,
	excludeTokens,
	selectedCategories,
	pathname,
	minTvl,
	maxTvl,
	minApy,
	maxApy
}) {
	let toFilter = true

	// used in pages like /yields/stablecoins to filter some pools by default
	attributeOptions.forEach((option) => {
		// check if this page has default attribute filter function
		if (option.defaultFilterFnOnPage[pathname]) {
			// apply default attribute filter function
			toFilter = toFilter && option.defaultFilterFnOnPage[pathname](curr)
		}
	})

	selectedAttributes.forEach((attribute) => {
		const attributeOption = attributeOptions.find((o) => o.key === attribute)

		if (attributeOption) {
			toFilter = toFilter && attributeOption.filterFn(curr)
		}
	})

	toFilter = toFilter && selectedProjects?.map((p) => p.toLowerCase()).includes(curr.project.toLowerCase())

	toFilter = toFilter && selectedCategories?.map((p) => p.toLowerCase()).includes(curr.category.toLowerCase())

	const tokensInPool: Array<string> = curr.symbol.split('-').map((x) => x.toLowerCase())

	const includeToken =
		includeTokens.length > 0 && includeTokens[0] !== 'All'
			? includeTokens
					.map((t) => t.toLowerCase())
					.find((token) => {
						if (tokensInPool.some((x) => x.includes(token.toLowerCase()))) {
							return true
						} else if (token === 'eth') {
							return tokensInPool.find((x) => x.includes('weth') && x.includes(token))
						} else return false
					})
			: true

	const excludeToken = !excludeTokens
		.map((t) => t.toLowerCase())
		.find((token) => tokensInPool.includes(token.toLowerCase()))

	toFilter =
		toFilter &&
		selectedChains.map((t) => t.toLowerCase()).includes(curr.chain.toLowerCase()) &&
		includeToken &&
		excludeToken

	const isValidTvlRange =
		(minTvl !== undefined && !Number.isNaN(Number(minTvl))) || (maxTvl !== undefined && !Number.isNaN(Number(maxTvl)))

	const isValidApyRange =
		(minApy !== undefined && !Number.isNaN(Number(minApy))) || (maxApy !== undefined && !Number.isNaN(Number(maxApy)))

	if (isValidTvlRange) {
		toFilter = toFilter && (minTvl ? curr.tvlUsd > minTvl : true) && (maxTvl ? curr.tvlUsd < maxTvl : true)
	}

	if (isValidApyRange) {
		toFilter = toFilter && (minApy ? curr.apy > minApy : true) && (maxApy ? curr.apy < maxApy : true)
	}

	return toFilter
}

export const findOptimizerPools = (pools, tokenToLend, tokenToBorrow, cdpRoutes) => {
	const availableToLend = pools.filter(
		({ symbol, ltv }) =>
			(tokenToLend === 'USD_Stables' ? true : symbol.includes(tokenToLend)) && ltv > 0 && !symbol.includes('AMM')
	)
	const availableProjects = availableToLend.map(({ project }) => project)
	const availableChains = availableToLend.map(({ chain }) => chain)

	const lendBorrowPairs = pools.reduce((acc, pool) => {
		if (
			!availableProjects.includes(pool.project) ||
			!availableChains.includes(pool.chain) ||
			(tokenToBorrow === 'USD_Stables' ? false : !pool.symbol.includes(tokenToBorrow)) ||
			pool.symbol.includes('AMM') ||
			pool.borrowable === false
		)
			return acc
		if (tokenToBorrow === 'USD_Stables' && !pool.stablecoin) return acc

		const collatteralPools = availableToLend.filter(
			(collateralPool) =>
				collateralPool.chain === pool.chain &&
				collateralPool.project === pool.project &&
				!collateralPool.symbol.includes(tokenToBorrow) &&
				collateralPool.pool !== pool.pool &&
				(pool.project === 'solend' ? collateralPool.poolMeta === pool.poolMeta : true) &&
				(tokenToLend === 'USD_Stables' ? collateralPool.stablecoin : true) &&
				(pool.project === 'compound-v3' ? pool.symbol === 'USDC' : true)
		)

		const poolsPairs = collatteralPools.map((collatteralPool) => ({
			...collatteralPool,
			chains: [collatteralPool.chain],
			borrow: pool
		}))

		return acc.concat(poolsPairs)
	}, [])

	// add cdp pairs
	const cdpPairs =
		tokenToLend && tokenToBorrow
			? cdpRoutes.filter(
					(p) => removeMetaTag(p.symbol).includes(tokenToLend) && removeMetaTag(p.borrow.symbol).includes(tokenToBorrow)
			  )
			: []

	return lendBorrowPairs.concat(cdpPairs)
}

const removeMetaTag = (symbol) => symbol.replace(/ *\([^)]*\) */g, '')

export const findStrategyPools = (pools, tokenToLend, tokenToBorrow, allPools, loopStrategies, cdpRoutes) => {
	const availableToLend = pools.filter(
		({ symbol, ltv }) =>
			(tokenToLend === 'USD_Stables' ? true : removeMetaTag(symbol).includes(tokenToLend)) &&
			ltv > 0 &&
			!removeMetaTag(symbol).includes('AMM')
	)
	const availableProjects = availableToLend.map(({ project }) => project)
	const availableChains = availableToLend.map(({ chain }) => chain)

	// lendBorrowPairs is the same as in the optimizer, only difference is the optional filter on tokenToBorrow
	let lendBorrowPairs = pools.reduce((acc, pool) => {
		if (
			!availableProjects.includes(pool.project) ||
			!availableChains.includes(pool.chain) ||
			(tokenToBorrow === 'USD_Stables' ? false : !removeMetaTag(pool.symbol).includes(tokenToBorrow)) ||
			removeMetaTag(pool.symbol).includes('AMM') ||
			pool.apyBorrow === null ||
			// remove any pools where token is not borrowable
			pool.borrowable === false
		)
			return acc
		if (tokenToBorrow === 'USD_Stables' && !pool.stablecoin) return acc

		const collatteralPools = availableToLend.filter(
			(collateralPool) =>
				collateralPool.chain === pool.chain &&
				collateralPool.project === pool.project &&
				(tokenToBorrow ? !removeMetaTag(collateralPool.symbol).includes(tokenToBorrow) : true) &&
				collateralPool.pool !== pool.pool &&
				(pool.project === 'solend' ? collateralPool.poolMeta === pool.poolMeta : true) &&
				(tokenToLend === 'USD_Stables' ? collateralPool.stablecoin : true) &&
				(pool.project === 'compound-v3' ? removeMetaTag(pool.symbol) === 'USDC' : true)
		)

		const poolsPairs = collatteralPools.map((collatteralPool) => ({
			...collatteralPool,
			chains: [collatteralPool.chain],
			borrow: pool
		}))

		return acc.concat(poolsPairs)
	}, [])

	// add cdp pairs
	let cdpPairs = []
	if (tokenToLend) {
		cdpPairs = cdpRoutes.filter((p) => removeMetaTag(p.symbol).includes(tokenToLend))
	}
	if (tokenToBorrow) {
		cdpPairs = cdpPairs.filter((p) => removeMetaTag(p.borrow.symbol).includes(tokenToBorrow))
	}
	lendBorrowPairs = lendBorrowPairs.concat(cdpPairs)

	let finalPools = []
	// if borrow token is specified
	if (tokenToBorrow) {
		// filter to suitable farm strategies
		const farmPools = allPools.filter((i) =>
			tokenToBorrow === 'USD_Stables' ? i.stablecoin : removeMetaTag(i.symbol).includes(tokenToBorrow)
		)
		for (const p of lendBorrowPairs) {
			for (const i of farmPools) {
				// we ignore strategies not on the same chain
				if (p.chain !== i.chain) continue
				// we ignore strategies where the farm symbol doesn't include tokenToBorrow
				// (special case of USD_Stables selector for which we need to check if the pool is a stablecoin
				// and also if the subset matches (eg if debt token = DAI -> should not be matched against a USDC farm)
				if (
					tokenToBorrow === 'USD_Stables'
						? !i.stablecoin || !removeMetaTag(i.symbol).includes(removeMetaTag(p.borrow.symbol).toUpperCase())
						: !removeMetaTag(i.symbol).includes(tokenToBorrow)
				)
					continue

				finalPools.push({
					...p,
					farmSymbol: i.symbol,
					farmChain: [i.chain],
					farmProjectName: i.projectName,
					farmProject: i.project,
					farmTvlUsd: i.tvlUsd,
					farmApy: i.apy,
					farmApyBase: i.apyBase,
					farmApyReward: i.apyReward
				})
			}
		}
	} else {
		for (const p of lendBorrowPairs) {
			for (const i of allPools) {
				// we ignore strategies not on the same chain
				if (p.chain !== i.chain) continue
				// ignore pools where farm symbol doesn't include the borrow symbol and vice versa
				// eg borrow symbol => WAVAX, farm symbol => AVAX (or borrow = AVAX and farm = WAVAX)
				// (if we'd just look in one way we'd miss some strategies)
				if (
					!removeMetaTag(i.symbol).includes(removeMetaTag(p.borrow.symbol).toUpperCase()) &&
					!removeMetaTag(p.borrow.symbol).toUpperCase().includes(removeMetaTag(i.symbol))
				)
					continue

				finalPools.push({
					...p,
					farmSymbol: i.symbol,
					farmChain: [i.chain],
					farmProjectName: i.projectName,
					farmProject: i.project,
					farmTvlUsd: i.tvlUsd,
					farmApy: i.apy,
					farmApyBase: i.apyBase,
					farmApyReward: i.apyReward
				})
			}
		}
	}
	// keep looping strategies only if no tokenToBorrow is given or if they both match
	const loopPools =
		tokenToBorrow !== tokenToLend && tokenToBorrow.length > 0
			? []
			: loopStrategies
					.filter((p) => removeMetaTag(p.symbol.toUpperCase()).includes(tokenToLend))
					.map((p) => ({
						...p,
						borrow: p,
						chains: [p.chain],
						farmSymbol: p.symbol,
						farmChain: [p.chain],
						farmProjectName: p.projectName,
						farmProject: p.project,
						farmTvlUsd: p.tvlUsd,
						farmApy: p.apy,
						farmApyBase: p.apyBase,
						farmApyReward: p.apyReward,
						strategy: 'loop'
					}))

	finalPools = finalPools.concat(loopPools)

	// calc the total strategy apy
	finalPools = finalPools.map((p) => {
		// apy = apyBase + apyReward on the collateral side
		// apyBorrow = apyBaseBorrow + apyRewardBorrow on the borrow side
		// farmApy = apyBase + apyReward on the farm side
		const totalApy = p.strategy === 'loop' ? p.loopApy : p.apy + p.borrow.apyBorrow * p.ltv + p.farmApy * p.ltv

		return {
			...p,
			totalApy,
			delta: totalApy - p.apy
		}
	})

	// keep pools with :
	// - profitable strategy only,
	// - require at least 1% delta compared to baseline (we could even increase this, otherwise we show lots of
	// strategies which are not really worth the effort)
	finalPools = finalPools.filter((p) => Number.isFinite(p.delta) && p.delta > 1).sort((a, b) => b.totalApy - a.totalApy)

	return finalPools
}

export const formatOptimizerPool = (pool) => {
	const lendingReward = (pool.apyBase || 0) + (pool.apyReward || 0)
	const borrowReward = (pool.borrow.apyBaseBorrow || 0) + (pool.borrow.apyRewardBorrow || 0)
	const totalReward = lendingReward + borrowReward * pool.ltv
	const borrowAvailableUsd = pool.borrow.totalAvailableUsd

	return { ...pool, lendingReward, borrowReward, totalReward, borrowAvailableUsd }
}

interface FilterPools {
	selectedChains: Array<string>
	selectedAttributes?: Array<string>
	selectedLendingProtocols?: Array<string>
	selectedFarmProtocols?: Array<string>
	pool: YieldsData['props']['pools'][number]
	minTvl?: string
	maxTvl?: string
	minAvailable?: string
	maxAvailable?: string
}

export const filterPool = ({
	pool,
	selectedChains,
	selectedAttributes,
	selectedLendingProtocols,
	selectedFarmProtocols,
	minTvl,
	maxTvl,
	minAvailable,
	maxAvailable
}: FilterPools) => {
	let toFilter = true

	toFilter = toFilter && selectedChains.map((chain) => chain.toLowerCase()).includes(pool.chain.toLowerCase())
	// stratey page filters
	if (selectedLendingProtocols) {
		toFilter = toFilter && selectedLendingProtocols.map((project) => project.toLowerCase()).includes(pool.project)
	}
	if (selectedFarmProtocols) {
		toFilter = toFilter && selectedFarmProtocols.map((project) => project.toLowerCase()).includes(pool.farmProject)
	}
	if (selectedAttributes) {
		selectedAttributes.forEach((attribute) => {
			const attributeOption = attributeOptions.find((o) => o.key === attribute)

			if (attributeOption) {
				toFilter = toFilter && attributeOption.filterFn(pool)
			}
		})
	}

	const isValidTvlRange =
		(minTvl !== undefined && !Number.isNaN(Number(minTvl))) || (maxTvl !== undefined && !Number.isNaN(Number(maxTvl)))

	if (isValidTvlRange) {
		toFilter = toFilter && (minTvl ? pool.farmTvlUsd > minTvl : true) && (maxTvl ? pool.tvlUsd < maxTvl : true)
	}

	const isValidAvailableRange =
		(minAvailable !== undefined && !Number.isNaN(Number(minAvailable))) ||
		(maxAvailable !== undefined && !Number.isNaN(Number(maxAvailable)))

	if (isValidAvailableRange) {
		toFilter =
			toFilter &&
			(minAvailable ? pool.borrow.totalAvailableUsd > minAvailable : true) &&
			(maxAvailable ? pool.borrow.totalAvailableUsd < maxAvailable : true)
	}

	return toFilter
}

export const lockupsRewards = ['Geist Finance', 'Radiant', 'Valas Finance', 'UwU Lend']
export const preminedRewards = ['0vix']
export const lockupsCollateral = [
	'Ribbon',
	'TrueFi',
	'Maple',
	'Clearpool',
	'Centrifuge',
	'UniCrypt',
	'Osmosis',
	'HedgeFarm',
	'BarnBridge',
	'WOOFi',
	'Kokoa Finance'
]
export const badDebt = ['moonwell-apollo', 'inverse-finance', 'venus', 'iron-bank']

export const disclaimer =
	'DefiLlama doesnt audit nor endorse any of the protocols listed, we just focus on providing accurate data. Ape at your own risk'
