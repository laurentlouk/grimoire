Rails.application.routes.draw do
  root 'pages#home'
  get 'about', to: 'pages#about'

  resources :posts do
    resources :comments, only: [:create, :destroy]
    member do
      post :publish
    end
  end

  namespace :admin do
    resources :photos, only: [:index, :show]
  end
end
