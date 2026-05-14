module.exports = function(req, res, next){

  if(!req.user || !req.user.isAdmin){

    return res.json({
      success:false,
      message:"Admin access denied"
    });

  }

  next();

};