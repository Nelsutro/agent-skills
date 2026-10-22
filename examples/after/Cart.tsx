import { useTranslations, useLocale } from 'next-intl'

type Props = { count: number; total: number; user: { name: string } }

export function Cart({ count, total, user }: Props) {
  const t = useTranslations('cart')

  return (
    <section aria-label={t('ariaLabel')}>
      <h2>{t('title')}</h2>
      <p>{t('greeting', { name: user.name, count })}</p>
      <button title={t('clearTitle')}>{t('clear')}</button>
      <input placeholder={t('couponPlaceholder')} />
      <p>{t('total', { amount: total })}</p>
      <button>{t('checkout')}</button>
    </section>
  )
}
