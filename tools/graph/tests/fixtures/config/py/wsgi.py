def app(request):
    return request.environ['HTTP_X_CANARY_HDR']
