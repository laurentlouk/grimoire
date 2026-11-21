Rails.application.routes.draw do
  root 'pages#home'
  get 'about', to: 'pages#about'

  resources :posts do
    post "archive"
    resources :comments, only: [:create, :destroy]
    member do
      post :publish
    end
  end

  resources :tags, except: %i[new edit update show destroy]

  namespace :admin do
    resources :photos, only: [:index, :show]
  end
end
